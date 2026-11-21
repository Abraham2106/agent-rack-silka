import { isBusy } from '../format.mjs';
import { loadSilkaConfig } from '../hub.mjs';
import { findGitRoot } from './git.mjs';
import { createHubCallAdapter } from './hub-call.mjs';
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

export async function superviseTasksOnce(client, { repoRoots, defaultAgent = 'codex', defaultModel = '' } = {}) {
  const callHub = createHubCallAdapter(client);
  const sessions = await client.listSessions();
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  let n = 0;
  for (const repoRoot of repoRoots?.length ? repoRoots : repoRootsToWatch()) {
    const mgr = createTaskManager(repoRoot);
    mgr.warnDiskIfNeeded();
    // eslint-disable-next-line no-await-in-loop
    const started = await mgr.startPendingSessions({ callHub, defaultAgent, defaultModel });
    n += started.length;

    for (const task of mgr.list()) {
      if (task.state !== STATES.TRABAJANDO || !task.sessionId) continue;
      const session = byId.get(task.sessionId);
      const busy = session ? isBusy(session.status) : false;
      mgr.setSessionAlive(task.id, busy);
      if (!busy) {
        mgr.finalizePendingDiscard(task.id);
        if (mgr.tryFinishAfterSession(task.id)) n += 1;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    n += await mgr.dispatchPendingRepairs({ callHub });
  }
  return n;
}

export function startTaskSupervisor({ readRuntime, connect, intervalMs = 400, defaultAgent, defaultModel } = {}) {
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
      if (client) await superviseTasksOnce(client, { defaultAgent, defaultModel });
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