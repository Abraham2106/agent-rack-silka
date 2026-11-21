import { silkaError } from '../codemode/errors.mjs';
import { warnLiveWorktreeBudget } from './disk.mjs';
import { diffSummary, currentCommit, findGitRoot } from './git.mjs';
import { buildDeliveryCard } from './card.mjs';
import { writeTaskLog } from './log-store.mjs';
import { validateTaskList, normalizeTaskInput } from './model.mjs';
import { allocatePorts, releasePorts, portsEnv } from './ports.mjs';
import {
  getTask,
  mutateTaskStore,
  newTaskId,
  readTaskStore,
} from './store.mjs';
import { activeWorkStates, canTransition, STATES } from './states.mjs';
import { createTaskWorktree, removeTaskWorktree } from './worktree.mjs';
import { assertVerifyDeclared, runVerifyCommands } from './verify.mjs';

function nowIso() {
  return new Date().toISOString();
}

function recordTransition(task, to, cause) {
  const from = task.state;
  if (!canTransition(from, to)) {
    throw silkaError('E_POLICY', `Transición inválida: ${from} → ${to}`);
  }
  task.state = to;
  task.version = (Number(task.version) || 0) + 1;
  task.transitions = task.transitions || [];
  task.transitions.push({ at: nowIso(), from, to, cause: cause || '' });
  return task;
}

function depsMerged(store, task) {
  const deps = task.dependsOn || [];
  if (!deps.length) return true;
  return deps.every((depId) => {
    const dep = store.tasks.find((t) => t.id === depId);
    return dep && dep.state === STATES.MEZCLADA;
  });
}

function depsDiscarded(store, task) {
  return (task.dependsOn || []).some((depId) => {
    const dep = store.tasks.find((t) => t.id === depId);
    return dep && (dep.state === STATES.DESCARTADA || dep.state === STATES.BLOQUEADA);
  });
}

function countActive(store) {
  return store.tasks.filter((t) => activeWorkStates().has(t.state)).length;
}

function launchPayload(task) {
  return {
    id: task.id,
    sessionId: task.sessionId,
    state: task.state,
    title: task.title,
    workspace: task.worktreePath,
    worktreePath: task.worktreePath,
    branch: task.branch,
    ports: task.allocatedPorts || [],
    version: task.version,
  };
}

function agentPrompt(task) {
  return [
    task.title,
    task.deliver ? `Entregar: ${task.deliver}` : '',
    task.scope?.length ? `Ámbito: ${task.scope.join(', ')}` : '',
    task.prompt || '',
  ].filter(Boolean).join('\n');
}

function parseHubJson(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export class TaskManager {
  constructor(workspace, opts = {}) {
    this.workspace = workspace;
    this.repoRoot = findGitRoot(workspace) || workspace;
    this.verifyTimeoutMs = opts.verifyTimeoutMs ?? 120_000;
    this.maxConcurrent = opts.maxConcurrentTasks;
    this.preferManual = opts.preferManual ?? true;
  }

  list() {
    return readTaskStore(this.repoRoot).tasks;
  }

  card(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (!task.card) throw silkaError('E_NOT_FOUND', `La tarea ${taskId} aún no tiene ficha.`);
    return task.card;
  }

  planFromList(items) {
    return validateTaskList(items);
  }

  registerPlan(specs, { cause } = {}) {
    const normalized = specs.map((s) => normalizeTaskInput(s, { id: s.id || newTaskId() }));
    const created = [];
    mutateTaskStore(this.repoRoot, (store) => {
      for (const spec of normalized) {
        if (store.tasks.some((t) => t.id === spec.id)) {
          throw silkaError('E_CONFLICT', `La tarea ${spec.id} ya existe.`);
        }
        const needsDeps = (spec.dependsOn || []).length > 0;
        const row = {
          ...spec,
          state: needsDeps ? STATES.ESPERANDO_DEPS : STATES.PLANIFICADA,
          version: 1,
          transitions: [{ at: nowIso(), from: null, to: needsDeps ? STATES.ESPERANDO_DEPS : STATES.PLANIFICADA, cause: cause || 'plan' }],
          createdAt: nowIso(),
          sessionAlive: false,
          pendingDiscard: false,
          baseCommit: null,
          worktreePath: null,
          branch: null,
          allocatedPorts: [],
          sessionId: null,
          awaitingHubSession: false,
          card: null,
        };
        store.tasks.push(row);
        created.push({ ...row });
      }
      if (this.maxConcurrent) store.maxConcurrentTasks = this.maxConcurrent;
      return store;
    });
    return created;
  }

  warnDiskIfNeeded() {
    return warnLiveWorktreeBudget(this.repoRoot);
  }

  async launch(specs, opts = {}) {
    const manual = opts.manual ?? !opts.callHub;
    this.preferManual = manual;
    const rows = this.registerPlan(specs, { cause: opts.cause || 'launch' });
    this.schedule({ manual });
    this.warnDiskIfNeeded();
    if (opts.callHub) await this.startPendingSessions(opts);
    return rows.map((t) => launchPayload(getTask(this.repoRoot, t.id) || t));
  }

  async startPendingSessions({ callHub, defaultAgent = 'codex', defaultModel = '' } = {}) {
    const pending = this.list().filter((t) => t.awaitingHubSession && t.worktreePath);
    const started = [];
    for (const task of pending) {
      const prompt = agentPrompt(task);
      if (!prompt.trim()) throw silkaError('E_POLICY', `La tarea ${task.id} no tiene prompt.`);
      const payload = {
        agent: task.agent || defaultAgent,
        prompt,
        workspace: task.worktreePath,
        model: task.model || defaultModel || undefined,
      };
      // eslint-disable-next-line no-await-in-loop
      const created = parseHubJson(await callHub('agent_session_create', payload));
      const sessionId = String(created.sessionId || '');
      if (!sessionId) throw silkaError('E_HUB', `El hub no devolvió sessionId para ${task.id}.`);
      mutateTaskStore(this.repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === task.id);
        if (!row) return store;
        row.sessionId = sessionId;
        row.awaitingHubSession = false;
        row.sessionAlive = true;
        recordTransition(row, STATES.TRABAJANDO, 'inicio_sesion_hub');
        return store;
      });
      started.push(task.id);
    }
    return started;
  }

  transition(taskId, to, cause) {
    mutateTaskStore(this.repoRoot, (store) => {
      const task = store.tasks.find((t) => t.id === taskId);
      if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
      recordTransition(task, to, cause);
      return store;
    });
    return getTask(this.repoRoot, taskId);
  }

  setSessionAlive(taskId, alive) {
    mutateTaskStore(this.repoRoot, (store) => {
      const task = store.tasks.find((t) => t.id === taskId);
      if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
      task.sessionAlive = Boolean(alive);
      return store;
    });
  }

  schedule({ manual = false } = {}) {
    const started = [];
    const pickList = [];
    mutateTaskStore(this.repoRoot, (store) => {
      const limit = this.maxConcurrent ?? store.maxConcurrentTasks ?? 5;
      for (const task of store.tasks) {
        if (countActive(store) + pickList.length >= limit) break;
        if (task.state === STATES.BLOQUEADA || task.state === STATES.DESCARTADA) continue;
        if (task.worktreePath) continue;
        if (depsDiscarded(store, task)) {
          task.blockedReason = 'Una dependencia fue descartada';
          recordTransition(task, STATES.BLOQUEADA, 'dependencia_descartada');
          continue;
        }
        const waiting = task.state === STATES.ESPERANDO_DEPS || task.state === STATES.PLANIFICADA;
        if (!waiting) continue;
        if ((task.dependsOn || []).length && !depsMerged(store, task)) continue;
        pickList.push({ id: task.id, ports: task.ports });
      }
      return store;
    });

    for (const pick of pickList) {
      const baseCommit = currentCommit(this.repoRoot);
      const wt = createTaskWorktree(this.repoRoot, pick.id, baseCommit);
      const ports = pick.ports > 0 ? allocatePorts(this.repoRoot, pick.id, pick.ports) : [];
      mutateTaskStore(this.repoRoot, (store) => {
        const task = store.tasks.find((t) => t.id === pick.id);
        if (!task) return store;
        task.baseCommit = wt.baseCommit;
        task.worktreePath = wt.worktreePath;
        task.branch = wt.branch;
        task.allocatedPorts = ports;
        if (manual) {
          recordTransition(task, STATES.TRABAJANDO, 'inicio_worktree');
        } else {
          task.awaitingHubSession = true;
        }
        started.push(task.id);
        return store;
      });
    }
    this.warnDiskIfNeeded();
    return started;
  }

  portsEnvFor(taskId) {
    const task = getTask(this.repoRoot, taskId);
    return portsEnv(task?.allocatedPorts);
  }

  async runAgentTurn(taskId, workFn, { agentNotes } = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.state !== STATES.TRABAJANDO && task.state !== STATES.RECHAZADA) {
      throw silkaError('E_POLICY', `La tarea ${taskId} no está en trabajo (estado: ${task.state}).`);
    }
    if (task.state === STATES.RECHAZADA) {
      this.transition(taskId, STATES.TRABAJANDO, 'rechazo_reanuda');
    }
    this.setSessionAlive(taskId, true);
    try {
      await workFn(task.worktreePath, portsEnv(task.allocatedPorts));
    } finally {
      this.setSessionAlive(taskId, false);
    }
    return this.finishAgentTurn(taskId, { agentNotes });
  }

  tryFinishAfterSession(taskId, { agentNotes } = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) return false;
    if (task.state === STATES.LISTA || task.state === STATES.REPARANDO) return false;
    if (task.sessionAlive) return false;
    if (task.state === STATES.VERIFICANDO && task.card) return false;
    if (task.state !== STATES.TRABAJANDO && task.state !== STATES.VERIFICANDO) return false;
    this.finishAgentTurn(taskId, { agentNotes });
    return true;
  }

  verifyTask(taskId, opts = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.sessionAlive) {
      throw silkaError('E_POLICY', 'La sesión del agente sigue viva; cancela antes de verificar.');
    }
    if (task.state === STATES.LISTA || task.state === STATES.REPARANDO) return task.card;
    return this.finishAgentTurn(taskId, { agentNotes: opts.agentNotes, force: opts.force });
  }

  finishAgentTurn(taskId, { agentNotes, force } = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.worktreePath) throw silkaError('E_POLICY', 'La tarea no tiene worktree.');
    if (!force && (task.state === STATES.LISTA || task.state === STATES.REPARANDO)) return task.card;

    let runVerify = false;
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row) return store;
      if (!force && (row.state === STATES.LISTA || row.state === STATES.REPARANDO)) return store;
      if (row.state === STATES.VERIFICANDO && row.card) return store;
      if (row.state === STATES.VERIFICANDO) {
        runVerify = true;
        return store;
      }
      if (row.state !== STATES.TRABAJANDO) return store;
      recordTransition(row, STATES.VERIFICANDO, 'fin_turno_agente');
      row.verifyStartedAt = new Date().toISOString();
      row.sessionAlive = false;
      runVerify = true;
      return store;
    });
    const current = getTask(this.repoRoot, taskId);
    if (!runVerify || !current) return current?.card;

    const verifyCmds = assertVerifyDeclared(current.verify);
    const env = portsEnv(current.allocatedPorts);
    const { ok, log } = runVerifyCommands(current.worktreePath, verifyCmds, {
      timeoutMs: this.verifyTimeoutMs,
      env,
    });
    const verifyRef = writeTaskLog(this.repoRoot, taskId, 'verify', log);
    const diff = diffSummary(current.worktreePath, current.baseCommit, { repoRoot: this.repoRoot });
    const card = buildDeliveryCard(current, { diff, verifyOk: ok, verifyRef, agentNotes });
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row) return store;
      row.card = card;
      delete row.verifyStartedAt;
      if (row.state === STATES.VERIFICANDO) {
        if (ok) recordTransition(row, STATES.LISTA, 'verify_ok');
        else recordTransition(row, STATES.REPARANDO, 'verify_falló');
      }
      return store;
    });
    return card;
  }

  markMerged(taskId, cause = 'mezcla') {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.sessionAlive) {
      throw silkaError('E_POLICY', 'No se puede mezclar mientras la sesión sigue viva.');
    }
    const cur = getTask(this.repoRoot, taskId);
    if (cur.state === STATES.LISTA) {
      this.transition(taskId, STATES.APROBADA, 'aprobación_previa_mezcla');
      this.transition(taskId, STATES.COLA_MEZCLA, 'cola_mezcla');
    }
    this.transition(taskId, STATES.MEZCLADA, cause);
    this.cleanupTask(taskId);
    this.schedule({ manual: this.preferManual });
    return getTask(this.repoRoot, taskId);
  }

  completeMerge(taskId, cause = 'cola_mezcla_ok') {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.state !== STATES.COLA_MEZCLA) {
      throw silkaError('E_POLICY', `completeMerge requiere en_cola_mezcla (estado: ${task.state}).`);
    }
    this.transition(taskId, STATES.MEZCLADA, cause);
    this.cleanupTask(taskId);
    this.schedule({ manual: this.preferManual });
    return getTask(this.repoRoot, taskId);
  }

  failMerge(taskId, detail, { callHub } = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.state !== STATES.COLA_MEZCLA) return task;
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row || row.state !== STATES.COLA_MEZCLA) return store;
      row.mergeFailure = detail;
      recordTransition(row, STATES.REPARANDO, 'mezcla_falló');
      return store;
    });
    return getTask(this.repoRoot, taskId);
  }

  requestDiscard(taskId, cause = 'descartar') {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.sessionAlive) {
      mutateTaskStore(this.repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === taskId);
        row.pendingDiscard = true;
        return store;
      });
      return { deferred: true, worktreeKept: true };
    }
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      recordTransition(row, STATES.DESCARTADA, cause);
      return store;
    });
    this.cleanupTask(taskId);
    return { deferred: false, worktreeKept: false };
  }

  finalizePendingDiscard(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.pendingDiscard || task.sessionAlive) return task;
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      recordTransition(row, STATES.DESCARTADA, 'descartar_pendiente');
      row.pendingDiscard = false;
      return store;
    });
    this.cleanupTask(taskId);
    return getTask(this.repoRoot, taskId);
  }

  cleanupTask(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task || task.sessionAlive) return;
    releasePorts(this.repoRoot, taskId);
    if (task.worktreePath) removeTaskWorktree(this.repoRoot, taskId);
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (row) {
        row.worktreePath = null;
        row.branch = null;
      }
      return store;
    });
  }
}

export function createTaskManager(workspace, opts) {
  return new TaskManager(workspace, opts);
}