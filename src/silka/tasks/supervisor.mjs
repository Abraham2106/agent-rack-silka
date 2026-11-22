import { isBusy } from '../format.mjs';
import { loadSilkaConfig } from '../hub.mjs';
import { findGitRoot } from './git.mjs';
import { createHubCallAdapter } from './hub-call.mjs';
import { createJobRunner } from './jobs.mjs';
import { createTaskManager } from './manager.mjs';
import { readTaskStore } from './store.mjs';
import { listTaskRepos } from './repo-registry.mjs';
import { STATES } from './states.mjs';

function repoRootsToWatch() {
  const { root } = loadSilkaConfig();
  const roots = new Set();
  const main = findGitRoot(root) || root;
  roots.add(main);
  for (const repo of listTaskRepos()) roots.add(repo);
  try {
    for (const task of readTaskStore(main).tasks) {
      if (task.worktreePath) {
        const wtRoot = findGitRoot(task.worktreePath);
        if (wtRoot) roots.add(wtRoot);
      }
    }
  } catch { /* sin store aún */ }
  return [...roots];
}

/** Estado final de una sesión de agent-rack: completed, failed, cancelled (o lo que reporte). */
export function sessionOutcomeOf(session) {
  const status = String(session?.status || '').trim();
  return status || 'desaparecida';
}

/**
 * Cómo terminó de verdad la sesión. agent-rack marca `completed` aunque el agente acabe con
 * error (p. ej. "Model unavailable": el último evento `result` trae `is_error: true`); visto con
 * agent-rack real. Se mira la cola del log una sola vez, al terminar la sesión.
 */
export async function sessionOutcomeFor(client, session) {
  if (!session) return { outcome: 'desaparecida', detail: 'la sesión ya no está en el hub' };
  const outcome = sessionOutcomeOf(session);
  const summary = String(session.summary || '').slice(0, 300);
  if (outcome !== 'completed' || typeof client.getSessionLogTail !== 'function') return { outcome, detail: summary };
  try {
    const tail = await client.getSessionLogTail(session.sessionId, 10);
    const result = [...(tail?.events || [])].reverse().find((e) => e?.metadata?.type === 'result');
    if (result?.metadata?.is_error) {
      return { outcome: 'failed', detail: String(result.metadata.result || result.content || summary).slice(0, 300) };
    }
  } catch { /* sin log: vale el estado que dio el hub */ }
  return { outcome, detail: summary };
}

/**
 * Un ciclo del supervisor. Con `jobs` (el hub), setup y verify se lanzan en un proceso aparte y
 * el ciclo no espera (BUG-11); sin `jobs` (pruebas, CLI) corren en línea como antes.
 */
export async function superviseTasksOnce(client, { repoRoots, defaultAgent = 'codex', defaultModel = '', log = () => {}, jobs } = {}) {
  const callHub = createHubCallAdapter(client);
  let byId = new Map((await client.listSessions()).map((s) => [s.sessionId, s]));
  let n = 0;
  for (const repoRoot of repoRoots?.length ? repoRoots : repoRootsToWatch()) {
    let mgr;
    try {
      mgr = createTaskManager(repoRoot);
      mgr.warnDiskIfNeeded();
      // eslint-disable-next-line no-await-in-loop
      const started = await mgr.startPendingSessions({ callHub, defaultAgent, defaultModel, log, jobs });
      n += started.length;
      if (started.length) {
        log(`[silka] sesiones arrancadas en ${repoRoot}: ${started.join(", ")}`);
        // Las sesiones recién creadas no estaban en la lista tomada al inicio del ciclo: sin
        // volver a pedirla, el supervisor las creía terminadas y verificaba la tarea en el
        // mismo instante en que el agente empezaba.
        // eslint-disable-next-line no-await-in-loop
        byId = new Map((await client.listSessions()).map((s) => [s.sessionId, s]));
      }
    } catch (err) {
      // Un repo con problemas no frena a los demás.
      log(`[silka] supervisor (${repoRoot}): ${err instanceof Error ? err.message : String(err)}`);
      if (!mgr) continue;
    }

    for (const task of mgr.list()) {
      // Verify interrumpido (el hub o su proceso se cayó a mitad): se relanza si nadie lo corre.
      if (jobs && task.state === STATES.VERIFICANDO && !task.card && !jobs.busy(repoRoot, task)) {
        if (jobs.start('verify', repoRoot, task.id)) n += 1;
        continue;
      }
      if (task.state !== STATES.TRABAJANDO || !task.sessionId) continue;
      const session = byId.get(task.sessionId);
      const busy = session ? isBusy(session.status) : false;
      mgr.setSessionAlive(task.id, busy);
      if (!busy) {
        // BUG-09: cómo terminó la sesión cuenta para la ficha. Una sesión que ya no aparece en
        // el hub (se reinició agent-rack, se borró) no es un éxito.
        if (!task.sessionOutcome) {
          // eslint-disable-next-line no-await-in-loop
          const { outcome, detail } = await sessionOutcomeFor(client, session);
          mgr.recordSessionOutcome(task.id, outcome, detail);
        }
        mgr.finalizePendingDiscard(task.id);
        if (mgr.tryFinishAfterSession(task.id, { jobs })) n += 1;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    n += await mgr.dispatchPendingRepairs({ callHub });
  }
  return n;
}

/** Un ciclo que no termina en este tiempo se da por colgado (p. ej. una respuesta del hub que no llega). */
const TICK_HANG_MS = 120_000;

export function startTaskSupervisor({ readRuntime, connect, intervalMs = 400, defaultAgent, defaultModel, repoRoots, log = (m) => console.error(m), jobs = createJobRunner({ log }) } = {}) {
  let client = null;
  let token = '';
  let running = false;
  let startedAt = 0;
  let tick = 0;
  let lastError = '';
  const timer = setInterval(async () => {
    if (running) {
      if (Date.now() - startedAt < TICK_HANG_MS) return;
      // Colgado: se abandona ese ciclo y su conexión; el siguiente reconecta.
      log('[silka] supervisor de tareas: ciclo colgado más de 2 min; se reconecta.');
      if (client) client.close().catch(() => {});
      client = null;
      token = '';
    }
    const mine = ++tick;
    running = true;
    startedAt = Date.now();
    try {
      const runtime = readRuntime?.();
      if (!runtime?.token) return;
      if (!client || token !== runtime.token) {
        if (client) await client.close().catch(() => {});
        token = runtime.token;
        client = await connect(runtime);
      }
      if (!client) log('[silka] supervisor de tareas: conectando con el hub');
      if (client) await superviseTasksOnce(client, { repoRoots, defaultAgent, defaultModel, log, jobs });
      lastError = '';
    } catch (err) {
      // Antes se tragaba en silencio: las tareas quedaban "planificadas" sin que nadie supiera por qué.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastError) log(`[silka] supervisor de tareas: ${msg}`);
      lastError = msg;
      if (client) await client.close().catch(() => {});
      client = null;
      token = '';
    } finally {
      if (mine === tick) running = false;
    }
  }, intervalMs);
  timer.unref?.();
  const stop = async () => {
    clearInterval(timer);
    if (client) await client.close().catch(() => {});
    client = null;
  };
  // Los trabajos en curso (verify) no se matan al parar: terminan solos y dejan su ficha.
  stop.jobs = jobs;
  return stop;
}