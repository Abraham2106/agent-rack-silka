import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { registerTaskRepo } from './repo-registry.mjs';
import { warnLiveWorktreeBudget } from './disk.mjs';
import { diffSummary, currentCommit, findGitRoot, gitRun } from './git.mjs';
import { RECIPE_FILE, commandsFor, readRecipe, workspaceEnv } from './recipe.mjs';
import {
  copyWorkspaceFiles,
  listWorkspaceRuns,
  runArchiveCommands,
  startWorkspaceRun,
  stopAllWorkspaceRuns,
  stopWorkspaceRun,
} from './workspace.mjs';
import { buildDeliveryCard } from './card.mjs';
import { writeTaskLog, readTaskLogRef } from './log-store.mjs';
import { validateTaskList, normalizeTaskInput } from './model.mjs';
import { loadRouting, resolveRouting } from '../routing.mjs';
import { runAcceptCriteria } from './accept.mjs';
import { buildRepairMessage } from './repair.mjs';
import { allocatePorts, releasePorts, portsEnv } from './ports.mjs';
import {
  getTask,
  mutateTaskStore,
  newTaskId,
  readTaskStore,
} from './store.mjs';
import { activeWorkStates, canTransition, STATES } from './states.mjs';
import { createTaskWorktree, isValidWorktree, removeTaskWorktree } from './worktree.mjs';
import { silkaSecretDenylist } from './denylist.mjs';
import { assertVerifyDeclared, runVerifyWithEvidence } from './verify.mjs';
import { lockfileHash, runSetupWithEvidence, setupForTask } from './setup.mjs';
import { integrationBlockedReason } from '../integration/runner.mjs';
import { recordDeliveryMetricIfClosed } from '../metrics/task-close.mjs';
import { deleteSessionNotes } from '../notes.mjs';
import { memoryPrefix, noteTaskFailure, seedMemory } from '../memory.mjs';
import { skillsPrefix } from '../skills.mjs';

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

/** Aviso al agente cuando su entrega no se pudo mezclar (conflicto, verify sobre main, etc.). */
function mergeRepairMessage(detail) {
  const kind = detail?.kind || 'mezcla';
  const head = kind === 'conflict'
    ? `Tu entrega choca con lo que ya está en main (archivos: ${(detail.paths || []).join(', ') || '?'}).`
    : `La mezcla de tu entrega con main falló (${kind}).`;
  const body = String(detail?.log || detail?.stderr || '').slice(-4000);
  const how = kind === 'conflict'
    ? 'Corre `git rebase main` en este directorio, resuelve los conflictos y termina el rebase. No cambies de rama.'
    : 'Corrige tu trabajo para que pase sobre main y vuelve a entregar. No cambies de rama.';
  return [head, how, body]
    .filter(Boolean).join('\n\n');
}

/** Evidencia de cómo terminó la sesión del agente; null si la tarea no tiene sesión del hub. */
function sessionEvidence(task) {
  if (!task.sessionId || !task.sessionOutcome) return null;
  const outcome = task.sessionOutcome;
  const ok = outcome === 'completed';
  return {
    kind: 'session',
    ok,
    cmd: '(sesión del agente)',
    detail: ok
      ? 'la sesión terminó bien'
      : `la sesión del agente terminó: ${outcome}${task.sessionOutcomeDetail ? ` (${task.sessionOutcomeDetail})` : ''}`,
    outcome,
    sessionId: task.sessionId,
    exitCode: null,
    durationMs: 0,
    ref: null,
  };
}

/** Evidencia de que hubo entrega: sin archivos cambiados falla, salvo allowEmptyDiff. */
function diffEvidence(diff, task) {
  const n = (diff?.files || []).length;
  const ok = n > 0 || Boolean(task.allowEmptyDiff);
  return {
    kind: 'diff',
    ok,
    cmd: '(cambios en el worktree)',
    detail: n > 0
      ? `${n} archivo(s) cambiado(s)`
      : (ok ? 'sin cambios (allowEmptyDiff)' : 'el agente no cambió ningún archivo'),
    files: n,
    exitCode: null,
    durationMs: 0,
    ref: null,
  };
}

/**
 * BUG-10: agent-rack tiene un tope de sesiones simultáneas (5 por defecto) que Silka no conoce:
 * lo descubre al fallar. Antes cada tarea pendiente reintentaba cada ~2 s y llenaba hub.log con la
 * misma línea. Ahora, al toparse con él, nadie pide sesión durante 30 s, y se avisa una sola vez
 * hasta que vuelva a haber cupo. Es del proceso (el hub), no de un repo: el tope es de agent-rack.
 */
export const SESSION_LIMIT_BACKOFF_MS = 30_000;
/** Estado de la espera (exportado para pruebas). */
export const sessionLimit = { until: 0, logged: false };

export function isSessionLimitError(msg) {
  return /Maximum concurrent sessions/i.test(String(msg || ''));
}

/** Solo para pruebas: olvida la espera por tope de sesiones. */
export function resetSessionLimitBackoff() {
  sessionLimit.until = 0;
  sessionLimit.logged = false;
}

function noteSessionLimit(log, msg) {
  sessionLimit.until = Date.now() + SESSION_LIMIT_BACKOFF_MS;
  if (sessionLimit.logged) return;
  sessionLimit.logged = true;
  log(`[silka] agent-rack no da más sesiones (${msg.replace(/^.*?(Maximum)/i, '$1')}); las tareas pendientes esperan y se reintenta cada ${SESSION_LIMIT_BACKOFF_MS / 1000} s.`);
}

function noteSessionCapacity(log) {
  if (!sessionLimit.logged) return;
  sessionLimit.logged = false;
  log('[silka] agent-rack vuelve a tener cupo de sesiones.');
}

const sessionLimitActive = () => Date.now() < sessionLimit.until;

/** Un reclamo de arranque vence a los 10 min aunque su proceso siga vivo (p. ej. un bridge colgado). */
const START_CLAIM_TTL_MS = 10 * 60_000;

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
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
    return validateTaskList(items, { repoRoot: this.repoRoot });
  }

  /**
   * Registra las tareas del plan. Un id ya usado da E_CONFLICT con un mensaje claro; si la tarea
   * vieja está descartada y se pide `replace` (`--reemplazar`, `replaceDiscarded`), la vieja se
   * conserva renombrada (`<id>~reemplazada-<n>`, con su historial) y el id queda libre.
   */
  registerPlan(specs, { cause, replace = false, manual = true } = {}) {
    const normalized = specs.map((s) => normalizeTaskInput(s, {
      id: s.id || newTaskId(),
      repoRoot: this.repoRoot,
      strictVerify: true,
    }));
    const created = [];
    mutateTaskStore(this.repoRoot, (store) => {
      const seen = new Set();
      for (const spec of normalized) {
        if (seen.has(spec.id)) throw silkaError('E_CONFLICT', `El plan repite el id ${spec.id}: cada tarea necesita un id propio.`);
        seen.add(spec.id);
        const old = store.tasks.find((t) => t.id === spec.id);
        if (old && old.state === STATES.DESCARTADA && replace) {
          let n = 1;
          while (store.tasks.some((t) => t.id === `${spec.id}~reemplazada-${n}`)) n += 1;
          old.id = `${spec.id}~reemplazada-${n}`;
          old.replacedBy = spec.id;
        } else if (old && old.state === STATES.DESCARTADA) {
          throw silkaError('E_CONFLICT', `El id ${spec.id} es de una tarea descartada; los ids no se reusan solos. `
            + `Usa otro id (p. ej. ${spec.id}-2) o relánzala reemplazando la descartada: `
            + '`silka task run --reemplazar` o `replaceDiscarded: true` en silka.launch.');
        } else if (old) {
          throw silkaError('E_CONFLICT', `Ya hay una tarea ${spec.id} (estado: ${old.state}). Usa otro id; `
            + 'solo una tarea descartada se puede reemplazar.');
        }
        const needsDeps = (spec.dependsOn || []).length > 0;
        const row = {
          ...spec,
          // Cómo arranca la tarea cuando le toque cupo: 'hub' (el supervisor crea la sesión del
          // agente) o 'manual' (turno a mano). Antes lo decidía quien llamara a schedule(): la mezcla,
          // que corre aparte con preferManual, pasaba las tareas en espera a trabajando sin agente.
          startMode: manual ? 'manual' : 'hub',
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
    // Restos del worktree o la rama de la tarea reemplazada no deben impedir crear los nuevos.
    if (replace) for (const row of created) removeTaskWorktree(this.repoRoot, row.id);
    return created;
  }

  warnDiskIfNeeded() {
    return warnLiveWorktreeBudget(this.repoRoot);
  }

  async launch(specs, opts = {}) {
    const manual = opts.manual ?? !opts.callHub;
    this.preferManual = manual;
    // agent-memory: los aprendizajes conocidos entran una sola vez por workspace; no frena el lanzamiento.
    try { seedMemory(this.repoRoot); } catch { /* la memoria es opcional */ }
    const rows = this.registerPlan(specs, { cause: opts.cause || 'launch', replace: Boolean(opts.replaceDiscarded), manual });
    try { registerTaskRepo(this.repoRoot); } catch { /* el registro no frena el lanzamiento */ }
    this.schedule({ manual });
    this.warnDiskIfNeeded();
    // BUG-05: con `deferStart` (el bridge y `silka task run`, que hablan con un hub vivo) el launch
    // solo registra y crea los worktrees; el setup y la sesión del agente los hace el supervisor del
    // hub (en proceso aparte). Antes el bridge los hacía aquí, síncronos y entre llamadas al hub: con
    // setup lento se cortaba su conexión (ECONNRESET, reproducido con un solo hub).
    if (opts.callHub && !opts.deferStart) await this.startPendingSessions(opts);
    return rows.map((t) => launchPayload(getTask(this.repoRoot, t.id) || t));
  }

  async startPendingSessions({ callHub, defaultAgent = 'codex', defaultModel = '', log = () => {}, jobs } = {}) {
    // Solo tareas que siguen vivas: antes arrancaba sesiones de tareas ya descartadas.
    const startable = new Set([STATES.PLANIFICADA, STATES.ESPERANDO_DEPS]);
    const pending = this.list().filter((t) => t.awaitingHubSession && t.worktreePath && startable.has(t.state));
    const started = [];
    for (const task of pending) {
      // BUG-05 (hallado al reproducirlo): el launch del bridge y el supervisor del hub arrancaban
      // la misma tarea a la vez (setup doble, dos sesiones del agente). Cada proceso reclama la
      // tarea antes de prepararla; si otro vivo la tiene reclamada, la deja.
      if (!this.claimStart(task.id)) continue;
      let keepClaim = false;
      try {
      // BUG-06: nunca se arranca un agente en un worktree perdido (git caería en otro repo).
      if (!isValidWorktree(task.worktreePath)) {
        this.blockTask(task.id, `worktree ausente o dañado: ${task.worktreePath}`);
        log(`[silka] ${task.id} bloqueada: su worktree no es válido.`);
        continue;
      }
      // BUG-11: en el hub, el setup (p. ej. npm install) corre en un proceso aparte; la sesión
      // del agente se crea en un ciclo posterior, cuando el setup ya terminó.
      if (!task.setupDoneAt && jobs) {
        if (!jobs.busy(this.repoRoot, task)) jobs.start('setup', this.repoRoot, task.id);
        keepClaim = true;
        continue;
      }
      // Setup al crear el worktree, antes del agente: así trabaja con sus dependencias.
      if (!task.setupDoneAt && !this.prepareWorktree(task.id)) {
        log(`[silka] ${task.id}: el setup falló; queda en verificacion_fallida.`);
        continue;
      }
      if (sessionLimitActive()) continue;
      // agent-memory: solo entradas vigentes del alcance de esta tarea, antes del encargo.
      // role-skills: skills del rol de la tarea y su alcance, con tope propio (nunca impiden lanzar).
      const prompt = memoryPrefix(this.repoRoot, task.scope)
        + skillsPrefix(this.repoRoot, { taskRole: task.role, scope: task.scope })
        + agentPrompt(task);
      if (!prompt.trim()) throw silkaError('E_POLICY', `La tarea ${task.id} no tiene prompt.`);
      // model-routing: explícito de la tarea, luego la tabla .silka/routing.json, luego el defecto.
      // Una tabla inválida falla esta tarea (queda en startError) sin lanzarla con esa tabla.
      const routing = resolveRouting(task, { routing: loadRouting(this.repoRoot), defaultAgent, defaultModel });
      const payload = {
        agent: routing.agent,
        prompt,
        workspace: task.worktreePath,
        model: routing.model || undefined,
      };
      // eslint-disable-next-line no-await-in-loop
      const created = parseHubJson(await callHub('agent_session_create', payload));
      const sessionId = String(created.sessionId || '');
      if (!sessionId) throw silkaError('E_HUB', `El hub no devolvió sessionId para ${task.id}.`);
      let orphan = false;
      mutateTaskStore(this.repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === task.id);
        // Se descartó (o bloqueó) mientras se creaba la sesión: esa sesión no debe vivir.
        if (!row || !startable.has(row.state)) {
          orphan = true;
          return store;
        }
        row.sessionId = sessionId;
        // Qué rol, agente y modelo corrieron y por qué regla (ficha, FR-MR-03).
        row.routing = routing;
        row.awaitingHubSession = false;
        row.sessionAlive = true;
        delete row.startError;
        delete row.startingBy;
        delete row.sessionOutcome;
        delete row.sessionOutcomeDetail;
        recordTransition(row, STATES.TRABAJANDO, 'inicio_sesion_hub');
        return store;
      });
      if (orphan) {
        log(`[silka] ${task.id} cambió de estado mientras arrancaba; se cancela su sesión ${sessionId}.`);
        // eslint-disable-next-line no-await-in-loop
        await callHub('agent_session_cancel', { sessionId }).catch(() => {});
        continue;
      }
      started.push(task.id);
      noteSessionCapacity(log);
      } catch (err) {
        // Una tarea que no arranca no bloquea a las demás; el motivo queda en la tarea.
        // silkaError devuelve un objeto plano ({ code, message }), no un Error: sin esto el log decía [object Object].
        const msg = err instanceof Error ? err.message : String(err?.message ?? err);
        const limit = isSessionLimitError(msg);
        if (limit) noteSessionLimit(log, msg);
        const stored = msg.slice(0, 500);
        // Mismo error que la vez anterior: no se repite en el log (BUG-10).
        if (!limit && task.startError !== stored) log(`[silka] no arrancó ${task.id}: ${msg}`);
        if (task.startError !== stored) {
          mutateTaskStore(this.repoRoot, (store) => {
            const row = store.tasks.find((t) => t.id === task.id);
            if (row) row.startError = stored;
            return store;
          });
        }
      } finally {
        if (!keepClaim) this.releaseStart(task.id);
      }
    }
    return started;
  }

  /**
   * Reclama arrancar la tarea (setup + sesión) para este proceso. Falla si otro proceso vivo la
   * tiene reclamada hace menos de START_CLAIM_TTL_MS, o si ya no está pendiente de arrancar.
   */
  claimStart(taskId) {
    let ok = false;
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row || !row.awaitingHubSession) return store;
      const c = row.startingBy;
      if (c && c.pid !== process.pid && processAlive(c.pid) && Date.now() - Number(c.at) < START_CLAIM_TTL_MS) return store;
      if (!c || c.pid !== process.pid) row.startingBy = { pid: process.pid, at: Date.now() };
      ok = true;
      return store;
    });
    return ok;
  }

  releaseStart(taskId) {
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (row?.startingBy?.pid === process.pid) delete row.startingBy;
      return store;
    });
  }

  /** Bloquea una tarea con un motivo visible (p. ej. worktree perdido). */
  blockTask(taskId, reason) {
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row || row.state === STATES.BLOQUEADA || !canTransition(row.state, STATES.BLOQUEADA)) return store;
      row.blockedReason = reason;
      row.awaitingHubSession = false;
      recordTransition(row, STATES.BLOQUEADA, 'worktree_invalido');
      return store;
    });
  }

  /**
   * Setup del worktree al crearlo, antes de arrancar al agente. Guarda la evidencia y la
   * huella del lockfile; verify solo lo repite si esa huella cambia. Si falla, la tarea no
   * arranca: queda en verificacion_fallida con el error íntegro en su ficha.
   */
  prepareWorktree(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.worktreePath) return false;
    const { recipe, errors: recipeErrors } = this.recipeFor();
    const sr = recipeErrors.length
      ? {
          ok: false,
          items: [{ kind: 'setup', ok: false, cmd: `${RECIPE_FILE}: ${recipeErrors.join('; ')}`, exitCode: null, durationMs: 0, ref: null }],
          setupRef: null,
          log: '',
        }
      : runSetupWithEvidence(this.repoRoot, taskId, task.worktreePath, this.setupSpecFor(task), {
          timeoutMs: this.verifyTimeoutMs,
          env: this.envFor(task),
          repoRootForLink: this.repoRoot,
          shell: recipe?.shell ?? null,
        });
    const hash = lockfileHash(task.worktreePath);
    if (sr.ok) {
      mutateTaskStore(this.repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === taskId);
        if (!row) return store;
        row.setupDoneAt = nowIso();
        row.setupLockHash = hash;
        row.setupEvidence = sr.items;
        return store;
      });
      return true;
    }
    const card = buildDeliveryCard(task, {
      diff: diffSummary(task.worktreePath, task.baseCommit, { repoRoot: this.repoRoot }),
      evidence: sr.items,
      verifyRef: sr.setupRef || null,
      agentSays: '',
      verifySource: task.verifySource,
    });
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row || !canTransition(row.state, STATES.VERIFICACION_FALLIDA)) return store;
      row.card = card;
      row.setupEvidence = sr.items;
      row.awaitingHubSession = false;
      row.startError = `setup falló: ${(sr.items.find((i) => !i.ok)?.cmd) || 'sin detalle'}`;
      recordTransition(row, STATES.VERIFICACION_FALLIDA, 'setup_fallido');
      return store;
    });
    recordDeliveryMetricIfClosed(this.repoRoot, taskId);
    // agent-memory: la ficha fallida registra su causa; el aprendizaje queda pendiente (no se inyecta).
    noteTaskFailure(this.repoRoot, task, `setup falló: ${sr.items.find((i) => !i.ok)?.cmd || 'sin detalle'}`);
    return false;
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

  /**
   * BUG-09: guarda cómo terminó la sesión del agente (completed, failed, cancelled o
   * desaparecida). Solo mientras la tarea está trabajando: es el dato de ese turno.
   */
  recordSessionOutcome(taskId, outcome, detail = '') {
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row || row.state !== STATES.TRABAJANDO) return store;
      row.sessionOutcome = String(outcome || 'desaparecida');
      if (detail) row.sessionOutcomeDetail = String(detail).slice(0, 300);
      else delete row.sessionOutcomeDetail;
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
        const waveBlock = integrationBlockedReason(this.repoRoot, task);
        if (waveBlock) {
          if (task.state !== STATES.BLOQUEADA) {
            task.blockedReason = waveBlock;
            recordTransition(task, STATES.BLOQUEADA, 'oleada_integración');
          }
          continue;
        }
        const waiting = task.state === STATES.ESPERANDO_DEPS || task.state === STATES.PLANIFICADA;
        if (!waiting) continue;
        if ((task.dependsOn || []).length && !depsMerged(store, task)) continue;
        pickList.push({ id: task.id, ports: task.ports, manual: task.startMode ? task.startMode === 'manual' : manual });
      }
      return store;
    });

    for (const pick of pickList) {
      const baseCommit = currentCommit(this.repoRoot);
      const wt = createTaskWorktree(this.repoRoot, pick.id, baseCommit, { denylist: silkaSecretDenylist() });
      // FR-TK-13 / FR-TK-14: con receta, se copian los no versionados y se reserva el rango de puertos.
      const { recipe } = this.recipeFor();
      if (recipe) copyWorkspaceFiles(this.repoRoot, wt.worktreePath, recipe);
      const portCount = pick.ports > 0 ? pick.ports : (recipe ? recipe.ports : 0);
      const ports = portCount > 0 ? allocatePorts(this.repoRoot, pick.id, portCount) : [];
      mutateTaskStore(this.repoRoot, (store) => {
        const task = store.tasks.find((t) => t.id === pick.id);
        if (!task) return store;
        task.baseCommit = wt.baseCommit;
        task.worktreePath = wt.worktreePath;
        task.branch = wt.branch;
        task.allocatedPorts = ports;
        if (pick.manual) {
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

  /** silka.json del repo (FR-TK-12). `recipe` es null si no hay archivo o si no valida. */
  recipeFor() {
    return readRecipe(this.repoRoot);
  }

  /** Setup de la tarea: el de la receta si lo declara para esta plataforma; si no, el de siempre. */
  setupSpecFor(task) {
    const { recipe } = this.recipeFor();
    if (recipe?.setup != null) {
      return { mode: 'install', commands: commandsFor(recipe.setup), source: 'declarado' };
    }
    return setupForTask(task, this.repoRoot);
  }

  /** Variables de entorno de la tarea (FR-TK-14): puertos y SILKA_* para setup, run, verify y agente. */
  envFor(task) {
    const ports = task?.allocatedPorts || [];
    const branch = gitRun(this.repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], { repoRoot: this.repoRoot });
    return {
      ...portsEnv(ports),
      ...workspaceEnv({
        taskId: task?.id,
        worktreePath: task?.worktreePath,
        rootPath: this.repoRoot,
        workspaceName: path.basename(path.resolve(this.repoRoot)),
        defaultBranch: branch.ok && branch.stdout.trim() ? branch.stdout.trim() : 'main',
        ports,
      }),
    };
  }

  /** `silka workspace run <tarea> <nombre>`: lanza un comando `run` de la receta en el worktree. */
  startTaskRun(taskId, name) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.worktreePath) throw silkaError('E_POLICY', `La tarea ${taskId} no tiene worktree.`);
    const { recipe } = this.recipeFor();
    if (!recipe) throw silkaError('E_POLICY', `No hay ${RECIPE_FILE} válido en el repo.`);
    if (!Object.prototype.hasOwnProperty.call(recipe.run, name)) {
      throw silkaError('E_NOT_FOUND', `La receta no define el run "${name}".`);
    }
    const command = commandsFor(recipe.run[name]).join(' && ');
    if (!command) throw silkaError('E_POLICY', `El run "${name}" no tiene comando para esta plataforma.`);
    return startWorkspaceRun({
      repoRoot: this.repoRoot,
      wt: task.worktreePath,
      name,
      command,
      shell: recipe.shell,
      env: this.envFor(task),
      runMode: recipe.runMode,
    });
  }

  /** `silka workspace stop <tarea> [nombre]`: detiene uno o todos los runs de la tarea. */
  stopTaskRun(taskId, name = null) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.worktreePath) throw silkaError('E_POLICY', `La tarea ${taskId} no tiene worktree.`);
    const ports = task.allocatedPorts || [];
    if (name) return [stopWorkspaceRun(task.worktreePath, name, { ports })];
    return stopAllWorkspaceRuns(task.worktreePath, { ports });
  }

  listTaskRuns(taskId) {
    const task = getTask(this.repoRoot, taskId);
    return task?.worktreePath ? listWorkspaceRuns(task.worktreePath) : [];
  }

  /**
   * `archive` de la tarea (FR-TK-15): detiene el árbol de procesos de sus runs, corre el `archive`
   * de la receta y solo después quita el worktree y libera los puertos.
   */
  archiveTaskWorkspace(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.sessionAlive) throw silkaError('E_POLICY', `La tarea ${taskId} tiene una sesión viva; no se archiva.`);
    const wt = task.worktreePath;
    const { recipe } = this.recipeFor();
    const stops = wt ? stopAllWorkspaceRuns(wt, { ports: task.allocatedPorts || [] }) : [];
    const archive = wt && recipe
      ? runArchiveCommands(wt, commandsFor(recipe.archive), { shell: recipe.shell, env: this.envFor(task) })
      : [];
    this.cleanupTask(taskId);
    return { taskId, stops, archive, worktreeRemoved: !wt || !fs.existsSync(wt) };
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
      await workFn(task.worktreePath, this.envFor(task));
    } finally {
      this.setSessionAlive(taskId, false);
    }
    return this.finishAgentTurn(taskId, { agentNotes });
  }

  /** ¿Toca cerrar el turno (verificar y hacer la ficha) ahora que la sesión terminó? */
  needsFinishAfterSession(taskId) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) return false;
    if (task.state === STATES.LISTA || task.state === STATES.VERIFICACION_FALLIDA) return false;
    if (task.state === STATES.REPARANDO && !task.pendingRepair) return false;
    if (task.sessionAlive) return false;
    if (task.state === STATES.VERIFICANDO && task.card) return false;
    return task.state === STATES.TRABAJANDO || task.state === STATES.VERIFICANDO;
  }

  tryFinishAfterSession(taskId, { agentNotes, jobs } = {}) {
    if (!this.needsFinishAfterSession(taskId)) return false;
    if (jobs) {
      // BUG-11: en el hub, el verify corre en un proceso aparte; la ficha llega en otro ciclo.
      const task = getTask(this.repoRoot, taskId);
      if (jobs.busy(this.repoRoot, task)) return false;
      return jobs.start('verify', this.repoRoot, taskId);
    }
    this.finishAgentTurn(taskId, { agentNotes });
    return true;
  }

  verifyTask(taskId, opts = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
    if (task.sessionAlive) {
      throw silkaError('E_POLICY', 'La sesión del agente sigue viva; cancela antes de verificar.');
    }
    if (task.state === STATES.LISTA || task.state === STATES.VERIFICACION_FALLIDA) return task.card;
    return this.finishAgentTurn(taskId, { agentNotes: opts.agentNotes, force: opts.force });
  }

  finishAgentTurn(taskId, { agentNotes, force } = {}) {
    const task = getTask(this.repoRoot, taskId);
    if (!task?.worktreePath) throw silkaError('E_POLICY', 'La tarea no tiene worktree.');
    if (!force && (task.state === STATES.LISTA || task.state === STATES.VERIFICACION_FALLIDA)) return task.card;

    let runVerify = false;
    let agotadoCause = null;
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row) return store;
      if (!force && (row.state === STATES.LISTA || row.state === STATES.VERIFICACION_FALLIDA)) return store;
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

    const verifyCmds = assertVerifyDeclared(current.verify, { allowNoVerify: current.allowNoVerify });
    const env = this.envFor(current);
    let evidence = [];
    let verifyRef = writeTaskLog(this.repoRoot, taskId, 'verify', '');
    let allOk = true;

    // BUG-06: un worktree perdido nunca se verifica (los comandos correrían en otro repo).
    const worktreeOk = isValidWorktree(current.worktreePath);
    // Sin worktree válido, git correría en otro repo: diff vacío.
    const diff = worktreeOk
      ? diffSummary(current.worktreePath, current.baseCommit, { repoRoot: this.repoRoot })
      : { files: [], added: 0, removed: 0, statText: '' };

    // BUG-09: antes la ficha salía "pass" con la sesión caída y sin un solo cambio, porque solo
    // miraba el verify (y `npm test` pasa sobre un worktree intacto). Ahora cuentan también cómo
    // terminó la sesión y que haya diff; si alguno falla, el verify ni se corre.
    const sessionItem = sessionEvidence(current);
    if (sessionItem) evidence.push(sessionItem);
    if (worktreeOk) evidence.push(diffEvidence(diff, current));
    const preOk = evidence.every((e) => e.ok);
    const sessionOk = !sessionItem || sessionItem.ok;
    allOk = preOk;

    if (!worktreeOk) {
      evidence.push({
        kind: 'setup',
        ok: false,
        cmd: '(comprobación del worktree)',
        detail: `worktree ausente o dañado: ${current.worktreePath}; no se verifica fuera de él`,
        exitCode: null,
        durationMs: 0,
        ref: null,
      });
      allOk = false;
    } else if (!preOk) {
      // Sesión caída o sin cambios: no hay entrega que verificar; no se corre setup ni verify.
    } else if (current.setupDoneAt && current.setupLockHash === lockfileHash(current.worktreePath)) {
      // Setup hecho al crear el worktree y el lockfile no cambió: no se repite.
      evidence.push({ kind: 'setup', ok: true, cmd: '(setup al crear el worktree; lockfile sin cambios)', exitCode: 0, durationMs: 0, ref: null });
    } else {
      const setupSpec = this.setupSpecFor(current);
      const sr = runSetupWithEvidence(this.repoRoot, taskId, current.worktreePath, setupSpec, {
        timeoutMs: this.verifyTimeoutMs,
        env,
        repoRootForLink: this.repoRoot,
        shell: this.recipeFor().recipe?.shell ?? null,
      });
      evidence = evidence.concat(sr.items);
      allOk = allOk && sr.ok;
    }

    if (allOk && verifyCmds.length) {
      const vr = runVerifyWithEvidence(this.repoRoot, taskId, current.worktreePath, verifyCmds, {
        timeoutMs: this.verifyTimeoutMs,
        env,
        shell: this.recipeFor().recipe?.shell ?? null,
      });
      // Se suma a la del setup (antes la sobrescribía y la ficha perdía el setup).
      evidence = evidence.concat(vr.items);
      verifyRef = vr.verifyRef;
      allOk = allOk && vr.ok;
    }
    if (allOk && (current.accept || []).length) {
      const ar = runAcceptCriteria(this.repoRoot, taskId, current.worktreePath, current.accept, {
        timeoutMs: this.verifyTimeoutMs,
        env,
      });
      evidence = evidence.concat(ar.items);
      allOk = allOk && ar.ok;
    }
    const card = buildDeliveryCard(current, {
      diff,
      evidence,
      verifyRef,
      agentSays: agentNotes,
      verifySource: current.verifySource,
    });
    mutateTaskStore(this.repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (!row) return store;
      row.card = card;
      delete row.verifyStartedAt;
      if (row.state === STATES.VERIFICANDO) {
        if (allOk) {
          recordTransition(row, STATES.LISTA, 'verify_ok');
        } else {
          const maxRepairs = Number.isInteger(row.maxRepairs) ? row.maxRepairs : 2;
          const repairs = Number(row.repairCount) || 0;
          // Una sesión que falló, se canceló o desapareció no se reanuda sola: decide el humano.
          if (sessionOk && repairs < maxRepairs && row.sessionId) {
            const repairId = `${row.id}-repair-${repairs + 1}`;
            const enriched = evidence.map((e) => {
              if (e.ref && !e.ok) {
                try {
                  return { ...e, logSnippet: readTaskLogRef(e.ref, this.repoRoot) };
                } catch {
                  return e;
                }
              }
              return e;
            });
            row.pendingRepair = {
              id: repairId,
              message: buildRepairMessage({ evidence: enriched, verifyRef }),
            };
            recordTransition(row, STATES.REPARANDO, 'verify_falló');
          } else {
            recordTransition(row, STATES.VERIFICACION_FALLIDA, 'verify_agotado');
            agotadoCause = evidence.find((e) => e && !e.ok)?.cmd || 'verificación fallida';
          }
        }
      }
      return store;
    });
    recordDeliveryMetricIfClosed(this.repoRoot, taskId);
    // agent-memory: fuera de la escritura del store (mismo lock); nunca lanza.
    if (agotadoCause) noteTaskFailure(this.repoRoot, task, `verificación agotada: ${agotadoCause}`);
    return card;
  }

  /** Despacha reparación a la misma sesión (idempotente si el hub reinicia). */
  async dispatchPendingRepairs({ callHub, log = () => {} } = {}) {
    if (!callHub) return 0;
    let n = 0;
    for (const task of this.list()) {
      const pr = task.pendingRepair;
      if (!pr?.message || !task.sessionId) continue;
      if (task.repairDispatchId === pr.id) continue;
      // BUG-06: sin worktree válido, reanudar al agente lo dejaría trabajando en otro repo.
      if (!isValidWorktree(task.worktreePath)) {
        this.blockTask(task.id, `worktree ausente o dañado: ${task.worktreePath}`);
        continue;
      }
      // Reanudar la sesión también cuenta para el tope de agent-rack (BUG-10).
      if (sessionLimitActive()) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await callHub('agent_session_send', { sessionId: task.sessionId, message: pr.message });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isSessionLimitError(msg)) throw err;
        noteSessionLimit(log, msg);
        continue;
      }
      mutateTaskStore(this.repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === task.id);
        if (!row?.pendingRepair || row.repairDispatchId === pr.id) return store;
        row.repairDispatchId = pr.id;
        row.repairCount = (Number(row.repairCount) || 0) + 1;
        delete row.pendingRepair;
        delete row.sessionOutcome;
        delete row.sessionOutcomeDetail;
        recordTransition(row, STATES.TRABAJANDO, 'reparación_auto');
        row.sessionAlive = true;
        return store;
      });
      n += 1;
    }
    return n;
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
      // La mezcla corre en un proceso aparte sin conexión al hub: en vez de mandarle el aviso al
      // agente desde ahí, queda como reparación pendiente y el supervisor de tareas la despacha
      // (manda el mensaje y la tarea vuelve a trabajando; al terminar se verifica de nuevo).
      const maxRepairs = Number.isInteger(row.maxRepairs) ? row.maxRepairs : 2;
      const repairs = Number(row.repairCount) || 0;
      if (row.sessionId && repairs < maxRepairs) {
        row.pendingRepair = { id: `${row.id}-merge-${repairs + 1}`, message: mergeRepairMessage(detail) };
      }
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
    // Tarea mezclada o descartada: sus notas de sesión ya no sirven (FR-SN-03).
    if (task.sessionId) {
      try { deleteSessionNotes(task.sessionId); } catch { /* las notas son volátiles: si falla, el prune las recoge */ }
    }
    releasePorts(this.repoRoot, taskId);
    if (task.worktreePath) removeTaskWorktree(this.repoRoot, taskId, task.worktreePath);
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