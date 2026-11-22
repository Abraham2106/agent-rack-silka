import fs from 'node:fs';
import { STATES } from './states.mjs';
import { readTaskStore } from './store.mjs';

/** NFR-DISK-01: avisa si hay más worktrees vivos que el tope suave. */
export function warnLiveWorktreeBudget(repoRoot, { log = console.warn } = {}) {
  const store = readTaskStore(repoRoot);
  const limit = (store.maxConcurrentTasks ?? 5)
    + store.tasks.filter((t) => t.state === STATES.LISTA).length;
  const alive = store.tasks.filter((t) => t.worktreePath && fs.existsSync(t.worktreePath)).length;
  if (alive > limit) {
    log(`[silka] worktrees vivos (${alive}) superan el tope suave (${limit}): revisa disco en ${repoRoot}`);
  }
  return { alive, limit };
}