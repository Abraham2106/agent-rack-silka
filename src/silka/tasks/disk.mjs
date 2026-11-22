import fs from 'node:fs';
import { STATES } from './states.mjs';
import { readTaskStore } from './store.mjs';

// Las tareas que esperan revisión o mezcla conservan su worktree a propósito: no cuentan como exceso.
const WAITING_WITH_WORKTREE = new Set([STATES.LISTA, STATES.APROBADA, STATES.COLA_MEZCLA]);
const lastWarned = new Map();

/**
 * NFR-DISK-01: avisa si hay más worktrees vivos que el tope suave. Una sola vez por situación:
 * el supervisor lo llama en cada ciclo y antes repetía la misma línea cada 400 ms.
 */
export function warnLiveWorktreeBudget(repoRoot, { log = console.warn } = {}) {
  const store = readTaskStore(repoRoot);
  const limit = (store.maxConcurrentTasks ?? 5)
    + store.tasks.filter((t) => WAITING_WITH_WORKTREE.has(t.state)).length;
  const alive = store.tasks.filter((t) => t.worktreePath && fs.existsSync(t.worktreePath)).length;
  const key = `${alive}/${limit}`;
  if (alive > limit) {
    if (lastWarned.get(repoRoot) !== key) {
      log(`[silka] worktrees vivos (${alive}) superan el tope suave (${limit}): revisa disco en ${repoRoot}`);
    }
    lastWarned.set(repoRoot, key);
  } else {
    lastWarned.delete(repoRoot);
  }
  return { alive, limit };
}