import { cachedModels, loadModels } from '../models.mjs';
import { isBusy } from '../format.mjs';
import { matchSession } from '../commands.mjs';
import { validateApiArgs } from './api-schema.mjs';
import { silkaError } from './errors.mjs';
import { getStoredRef } from './output-store.mjs';

const NOT_IMPL = new Set([
  'plan.fromFile',
  'plan.fromList',
  'card',
  'review.inbox',
  'review.approve',
  'review.reject',
  'review.discard',
  'merge.queue',
  'merge.status',
  'agents.stats',
]);

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
    if (NOT_IMPL.has(method)) {
      throw silkaError('E_NOT_IMPLEMENTED', `${method} aún no está implementado en Silka v1 (F2–F5).`);
    }
    const validated = validateApiArgs(path, args);

    if (method === 'get') {
      return getStoredRef(validated[0]);
    }

    if (method === 'launch') {
      const [planOrTask, opts = {}] = validated;
      const tasks = normalizeTasks(planOrTask);
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
        if (!isBusy(card?.status)) return card;
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
      return ids.map((id) => out.get(String(id)));
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

    throw silkaError('E_NOT_IMPLEMENTED', `Método de API desconocido: ${method}`);
  };
}