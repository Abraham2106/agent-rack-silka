// Proceso aparte para el setup y el verify de una tarea (BUG-11). Antes corrían con spawnSync
// dentro del ciclo del supervisor del hub: un verify de ~3 min congelaba el hub entero y se caía
// su conexión con agent-rack. Aquí corren igual que antes (mismo código, síncrono), pero en otro
// proceso: el hub solo lo lanza y lee el resultado del store de tareas.
// La mezcla (rebase, setup, verify sobre main, fast-forward) y la integración de oleada corren
// igual en un proceso aparte, por la misma razón.
//   node job-worker.mjs <setup|verify> <repoRoot> <taskId>
//   node job-worker.mjs merge <repoRoot> <taskId> <fencingToken>
//   node job-worker.mjs integration <repoRoot> <planId> <ola>
import { createTaskManager } from './manager.mjs';
import { mutateTaskStore } from './store.mjs';

const [kind, repoRoot, taskId, ...extra] = process.argv.slice(2);
if (!['setup', 'verify', 'merge', 'integration'].includes(kind) || !repoRoot || !taskId) {
  console.error('uso: job-worker.mjs <setup|verify|merge|integration> <repoRoot> <taskId|planId> [...]');
  process.exit(2);
}

// Hora de inicio propia: con ella el hub distingue este proceso de otro que reutilice su pid.
const startedAt = Math.round(Date.now() - process.uptime() * 1000);
const setJob = (value) => mutateTaskStore(repoRoot, (store) => {
  const row = store.tasks.find((t) => t.id === taskId);
  if (!row) return store;
  if (value) row.job = value;
  else if (row.job?.pid === process.pid) delete row.job;
  return store;
});

let code = 0;
try {
  setJob({ kind, pid: process.pid, startedAt });
  if (kind === 'merge') {
    const { mergeOneTask } = await import('../merge/runner.mjs');
    const res = await mergeOneTask(repoRoot, taskId, { fencingToken: Number(extra[0]) });
    if (res?.repaired) console.error(`mezcla de ${taskId} falló: ${JSON.stringify(res.detail).slice(0, 300)}`);
  } else if (kind === 'integration') {
    const { recoverIntegrationRun } = await import('../integration/runner.mjs');
    recoverIntegrationRun(repoRoot, taskId, Number(extra[0]));
  } else {
    const mgr = createTaskManager(repoRoot);
    if (kind === 'setup') mgr.prepareWorktree(taskId);
    else mgr.finishAgentTurn(taskId);
  }
} catch (err) {
  console.error(err instanceof Error ? (err.stack || err.message) : String(err));
  code = 1;
} finally {
  try { setJob(null); } catch { /* el hub verá el pid muerto */ }
}
process.exit(code);
