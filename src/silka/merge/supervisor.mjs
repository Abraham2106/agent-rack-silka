import path from 'node:path';
import { loadSilkaConfig } from '../hub.mjs';
import { createJobRunner } from '../tasks/jobs.mjs';
import { listTaskRepos } from '../tasks/repo-registry.mjs';
import { findGitRoot } from '../tasks/git.mjs';
import { createHubCallAdapter } from '../tasks/hub-call.mjs';
import { readTaskStore } from '../tasks/store.mjs';
import { STATES } from '../tasks/states.mjs';
import { claimMergeLease } from './owner.mjs';
import { recoverIncompleteMerge } from './recover.mjs';
import { drainMergeQueue } from './runner.mjs';
import { listMergeQueue } from './queue.mjs';
import { listPlans } from '../integration/store.mjs';
import { recoverIntegrationRun } from '../integration/runner.mjs';

function repoRootsWithMergeQueue() {
  const { root } = loadSilkaConfig();
  const roots = new Set();
  const main = findGitRoot(root) || root;
  roots.add(main);
  for (const repo of listTaskRepos()) roots.add(repo);
  try {
    for (const task of readTaskStore(main).tasks) {
      if (task.state === STATES.COLA_MEZCLA && task.worktreePath) {
        const wtRoot = findGitRoot(task.worktreePath);
        if (wtRoot) roots.add(wtRoot);
      }
    }
  } catch { /* sin store */ }
  return [...roots];
}

/**
 * Con `jobs` (el hub): la mezcla y la integración de oleada corren en un proceso aparte, de a una
 * por repo, y el ciclo no espera. Antes corrían aquí con spawnSync (setup + verify sobre main):
 * visto con agent-rack real, la mezcla de una tarea con verify de 25 s dejó el hub quieto 27 s y se
 * cayó su conexión (lo mismo que BUG-11 en las tareas).
 */
function mergeJobAlive(repoRoot, jobs, key) {
  if (jobs.busyKey(key)) return true;
  try {
    return readTaskStore(repoRoot).tasks.some((t) => t.job?.kind === 'merge' && jobs.busy(repoRoot, t));
  } catch {
    return false;
  }
}

function startMergeJobs(repoRoot, lease, jobs) {
  const key = `merge|${path.resolve(repoRoot).toLowerCase()}`;
  if (mergeJobAlive(repoRoot, jobs, key)) return 0;
  recoverIncompleteMerge(repoRoot, lease.fencingToken);
  const head = listMergeQueue(repoRoot)[0];
  if (head) return jobs.start('merge', repoRoot, head.id, { key, args: [lease.fencingToken] }) ? 1 : 0;
  for (const plan of listPlans(repoRoot)) {
    for (let w = 0; w < (plan.waves?.length || 0); w += 1) {
      if (plan.wavesState?.[w]?.status === 'running') {
        return jobs.start('integration', repoRoot, plan.id, { key, args: [w] }) ? 1 : 0;
      }
    }
  }
  return 0;
}

export async function superviseMergeOnce(client, { repoRoots, jobs } = {}) {
  const callHub = createHubCallAdapter(client);
  let n = 0;
  const roots = repoRoots?.length ? repoRoots : repoRootsWithMergeQueue();
  for (const repoRoot of roots) {
    const lease = claimMergeLease(repoRoot);
    if (!lease.ok) continue;
    if (jobs) {
      n += startMergeJobs(repoRoot, lease, jobs);
      continue;
    }
    recoverIncompleteMerge(repoRoot, lease.fencingToken);
    // eslint-disable-next-line no-await-in-loop
    const res = await drainMergeQueue(repoRoot, { fencingToken: lease.fencingToken, callHub });
    if (res.processed) n += 1;
    for (const plan of listPlans(repoRoot)) {
      for (let w = 0; w < (plan.waves?.length || 0); w += 1) {
        const ws = plan.wavesState?.[w];
        if (ws?.status === 'running') {
          // eslint-disable-next-line no-await-in-loop
          await recoverIntegrationRun(repoRoot, plan.id, w);
        }
      }
    }
  }
  return n;
}

export function startMergeSupervisor({ readRuntime, connect, intervalMs = 500, repoRoots, log = (m) => console.error(m), jobs = createJobRunner({ log }) } = {}) {
  let client = null;
  let token = '';
  let running = false;
  let lastError = '';
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const runtime = readRuntime?.();
      if (!runtime?.token) return;
      if (!client || token !== runtime.token) {
        if (client) await client.close().catch(() => {});
        token = runtime.token;
        client = await connect(runtime);
      }
      if (client) await superviseMergeOnce(client, { repoRoots, jobs });
      lastError = '';
    } catch (err) {
      // Antes se tragaba en silencio (como BUG-03 en el de tareas): una mezcla atascada no dejaba rastro.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastError) log(`[silka] supervisor de mezcla: ${msg}`);
      lastError = msg;
      if (client) await client.close().catch(() => {});
      client = null;
      token = '';
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  const stop = async () => {
    clearInterval(timer);
    if (client) await client.close().catch(() => {});
    client = null;
  };
  // Una mezcla en curso no se mata al parar: termina sola y su diario permite recuperarla.
  stop.jobs = jobs;
  return stop;
}