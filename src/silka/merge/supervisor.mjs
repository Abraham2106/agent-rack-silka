import { loadSilkaConfig } from '../hub.mjs';
import { findGitRoot } from '../tasks/git.mjs';
import { createHubCallAdapter } from '../tasks/hub-call.mjs';
import { readTaskStore } from '../tasks/store.mjs';
import { STATES } from '../tasks/states.mjs';
import { claimMergeLease } from './owner.mjs';
import { recoverIncompleteMerge } from './recover.mjs';
import { drainMergeQueue } from './runner.mjs';
import { listPlans } from '../integration/store.mjs';
import { recoverIntegrationRun } from '../integration/runner.mjs';

function repoRootsWithMergeQueue() {
  const { root } = loadSilkaConfig();
  const roots = new Set();
  const main = findGitRoot(root) || root;
  roots.add(main);
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

export async function superviseMergeOnce(client, { repoRoots } = {}) {
  const callHub = createHubCallAdapter(client);
  let n = 0;
  const roots = repoRoots?.length ? repoRoots : repoRootsWithMergeQueue();
  for (const repoRoot of roots) {
    const lease = claimMergeLease(repoRoot);
    if (!lease.ok) continue;
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

export function startMergeSupervisor({ readRuntime, connect, intervalMs = 500 } = {}) {
  let client = null;
  let token = '';
  let running = false;
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
      if (client) await superviseMergeOnce(client);
    } catch {
      if (client) await client.close().catch(() => {});
      client = null;
      token = '';
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    if (client) await client.close().catch(() => {});
    client = null;
  };
}