import nodePath from 'node:path';
import { cachedModels, loadModels } from '../models.mjs';
import { isBusy } from '../format.mjs';
import { matchSession } from '../commands.mjs';
import { createMergeService } from '../merge/service.mjs';
import { createIntegrationService } from '../integration/service.mjs';
import { createReviewService } from '../review/service.mjs';
import { auditBlocked, taskScopeViolation } from '../containment.mjs';
import { createTaskManager } from '../tasks/manager.mjs';
import { addMemory, confirmMemory, expireMemory, listMemory, replaceMemory } from '../memory.mjs';
import { planFromFile, planFromList } from '../tasks/plan.mjs';
import { readTaskLogRef } from '../tasks/log-store.mjs';
import { validateApiArgs } from './api-schema.mjs';
import { silkaError } from './errors.mjs';
import { getStoredRef } from './output-store.mjs';
import { getContextRef } from '../context/ref-store.mjs';
import { aggregateAgentStats } from '../metrics/stats.mjs';
import { enrichWaitCard } from './wait-result.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hubText(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text ?? '';
  if (result?.isError) throw silkaError('E_HUB', text || 'El hub devolvió un error.');
  return text;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sessionLogEvents(callHub, sessionId) {
  try {
    const page = parseJson(hubText(await callHub('agent_session_logs', { sessionId, tail: 2000 })));
    return Array.isArray(page?.events) ? page.events : [];
  } catch {
    return [];
  }
}

async function finishWaitCard(ctx, sessionId, card) {
  const events = await sessionLogEvents(ctx.callHub, sessionId);
  return enrichWaitCard(card, events);
}

function normalizeTasks(planOrTask) {
  return Array.isArray(planOrTask) ? planOrTask : [planOrTask];
}

function taskPrompt(task) {
  return String(task.prompt || task.title || '').trim();
}

/**
 * @param {object} ctx
 * @param {string} ctx.workspace
 * @param {(name: string, args: object) => Promise<any>} ctx.callHub
 * @param {(name: string, args: object) => Promise<any>} ctx.callBridgeTool
 * @param {() => Promise<any[]>} ctx.listSessions
 */
export function createApiDispatcher(ctx) {
  return async function dispatchApi(path, args) {
    const method = path.join('.');
    const validated = validateApiArgs(path, args);
    // SEC-16: una tarea solo toca su propio estado; el intento queda auditado y avisa al manager.
    const violation = taskScopeViolation(method, validated, ctx.ownTaskId);
    if (violation) {
      auditBlocked({ taskId: ctx.ownTaskId, action: `codemode ${method}`, rule: 'SEC-16', message: violation });
      throw silkaError('E_POLICY', violation);
    }

    if (method === 'get') {
      const ref = validated[0];
      if (String(ref).startsWith('log:')) {
        return readTaskLogRef(ref, ctx.workspace);
      }
      if (String(ref).startsWith('ctx:')) {
        return getContextRef(ref, ctx.workspace);
      }
      return getStoredRef(ref);
    }

    if (method === 'plan.fromFile') {
      const ws = nodePath.resolve(ctx.workspace);
      return planFromFile(validated[0], ws);
    }

    if (method === 'plan.fromList') {
      return planFromList(validated[0], nodePath.resolve(ctx.workspace));
    }

    if (method === 'card') {
      const mgr = createTaskManager(ctx.workspace);
      return mgr.card(validated[0]);
    }

    if (method === 'launch') {
      const [planOrTask, opts = {}] = validated;
      const tasks = normalizeTasks(planOrTask);
      if (opts.isolate === 'worktree') {
        const ws = nodePath.resolve(opts.workspace || ctx.workspace);
        const mgr = createTaskManager(ws, {
          maxConcurrentTasks: opts.maxConcurrentTasks,
          preferManual: false,
        });
        return mgr.launch(tasks, {
          cause: 'codemode',
          callHub: ctx.callHub,
          defaultAgent: opts.agent,
          defaultModel: opts.model,
          replaceDiscarded: Boolean(opts.replaceDiscarded),
          // El hub arranca setup y sesión: el bridge no queda bloqueado (BUG-05).
          deferStart: true,
        });
      }
      const launched = [];
      for (const task of tasks) {
        const prompt = taskPrompt(task);
        if (!prompt) throw silkaError('E_POLICY', 'Cada tarea necesita title o prompt.');
        const payload = {
          agent: task.agent || opts.agent || 'codex',
          prompt,
          workspace: task.workspace || opts.workspace || ctx.workspace,
          mode: opts.mode,
          model: task.model || opts.model,
          timeoutSeconds: opts.timeoutSeconds,
        };
        const text = hubText(await ctx.callHub('agent_session_create', payload));
        launched.push(parseJson(text));
      }
      return launched.length === 1 ? launched[0] : launched;
    }

    if (method === 'status') {
      const text = hubText(await ctx.callHub('agent_session_status', { sessionId: validated[0] }));
      return parseJson(text);
    }

    if (method === 'cancel') {
      const text = hubText(await ctx.callHub('agent_session_cancel', { sessionId: validated[0] }));
      return parseJson(text);
    }

    if (method === 'wait') {
      const [sessionId, opts = {}] = validated;
      const timeoutMs = (Number(opts.timeoutSeconds) > 0 ? Number(opts.timeoutSeconds) : 900) * 1000;
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const card = await dispatchApi(['status'], [sessionId]);
        if (!isBusy(card?.status)) return finishWaitCard(ctx, sessionId, card);
        await sleep(1500);
      }
      throw silkaError('E_LIMIT', 'Tiempo de espera agotado en wait.', { limit: 'timeoutSeconds', value: opts.timeoutSeconds || 900 });
    }

    if (method === 'waitAll') {
      const [ids, opts = {}] = validated;
      const timeoutMs = (Number(opts.timeoutSeconds) > 0 ? Number(opts.timeoutSeconds) : 900) * 1000;
      const started = Date.now();
      const pending = new Set(ids.map(String));
      const out = new Map();
      while (pending.size && Date.now() - started < timeoutMs) {
        for (const id of [...pending]) {
          const card = await dispatchApi(['status'], [id]);
          out.set(id, card);
          if (!isBusy(card?.status)) pending.delete(id);
        }
        if (pending.size) await sleep(1500);
      }
      if (pending.size) {
        throw silkaError('E_LIMIT', 'Tiempo de espera agotado en waitAll.', { limit: 'timeoutSeconds', value: opts.timeoutSeconds || 900 });
      }
      const cards = await Promise.all(ids.map((id) => finishWaitCard(ctx, String(id), out.get(String(id)))));
      return cards;
    }

    if (method === 'send') {
      const [sessionId, text, opts = {}] = validated;
      if (opts.now === true) {
        const sessions = await ctx.listSessions();
        const session = matchSession(sessions, sessionId);
        return hubText(await ctx.callBridgeTool('silka_send', {
          sessionId: session.sessionId,
          text,
          now: true,
          workspace: ctx.workspace,
        }));
      }
      return hubText(await ctx.callHub('agent_session_send', { sessionId, message: text }));
    }

    if (method === 'state.summary') {
      const text = await ctx.callBridgeTool('silka_state', { workspace: ctx.workspace });
      return { text: typeof text === 'string' ? text : hubText(text) };
    }
    if (method === 'state.changes') {
      const text = await ctx.callBridgeTool('silka_changes', { workspace: ctx.workspace, since: validated[0] });
      return typeof text === 'string' ? text : hubText(text);
    }
    if (method === 'state.decide') {
      const text = await ctx.callBridgeTool('silka_decide', { workspace: ctx.workspace, text: validated[0] });
      return typeof text === 'string' ? text : hubText(text);
    }

    if (method === 'memory.list') {
      return listMemory(ctx.workspace, validated[0] || {});
    }
    if (method === 'memory.add') {
      return addMemory(ctx.workspace, { author: 'manager', ...validated[0] });
    }
    if (method === 'memory.confirm') {
      return confirmMemory(ctx.workspace, validated[0], { by: 'manager' });
    }
    if (method === 'memory.expire') {
      return expireMemory(ctx.workspace, validated[0], { by: 'manager' });
    }
    if (method === 'memory.replace') {
      return replaceMemory(ctx.workspace, validated[0], validated[1], { by: 'manager' });
    }

    if (method === 'agents.list') {
      const text = hubText(await ctx.callHub('agent_list_available', {}));
      return parseJson(text);
    }

    if (method === 'agents.models') {
      const agent = validated[0];
      let models = cachedModels(agent);
      if (!models?.length) {
        try {
          models = await loadModels(agent, { refresh: false });
        } catch {
          models = [];
        }
      }
      return models;
    }

    if (method === 'review.inbox') {
      const svc = createReviewService(ctx.workspace, { actor: 'manager' });
      return svc.inbox();
    }

    if (method === 'review.approve') {
      const [taskId, opt = {}] = validated;
      const svc = createReviewService(ctx.workspace, { actor: 'manager' });
      return svc.approve(taskId, opt);
    }

    if (method === 'review.reject') {
      const [taskId, note, opt = {}] = validated;
      const svc = createReviewService(ctx.workspace, {
        actor: 'manager',
        callHub: ctx.callHub,
      });
      return svc.reject(taskId, note, opt);
    }

    if (method === 'review.discard') {
      const [taskId, opt = {}] = validated;
      const svc = createReviewService(ctx.workspace, { actor: 'manager' });
      return svc.discard(taskId, opt);
    }

    if (method === 'merge.queue') {
      const svc = createMergeService(ctx.workspace);
      return svc.queue();
    }

    if (method === 'merge.status') {
      const svc = createMergeService(ctx.workspace);
      return svc.status(validated[0]);
    }

    if (method === 'plan.status') {
      const svc = createIntegrationService(ctx.workspace);
      return svc.planStatus(validated[0]);
    }

    if (method === 'agents.stats') {
      const agent = validated[0];
      const model = validated[1];
      return aggregateAgentStats(ctx.workspace, { agent, model });
    }

    throw silkaError('E_NOT_IMPLEMENTED', `Método de API desconocido: ${method}`);
  };
}