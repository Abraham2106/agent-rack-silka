import fs from 'node:fs';
import path from 'node:path';
import { gitRun } from '../tasks/git.mjs';
import { prepareWorktreeRemoval } from '../tasks/worktree-cleanup.mjs';

function intWorktreePath(repoRoot, tag) {
  return path.join(repoRoot, '.silka', 'worktrees', `_int-${tag}`);
}

export function withDetachedWorktree(repoRoot, commitSha, fn, { tag = 'run' } = {}) {
  const wt = intWorktreePath(repoRoot, `${tag}-${Date.now()}`);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const add = gitRun(repoRoot, ['worktree', 'add', '--detach', wt, commitSha], { repoRoot });
  if (!add.ok) throw new Error(add.stderr || 'worktree add falló');
  try {
    return fn(wt);
  } finally {
    prepareWorktreeRemoval(repoRoot, wt);
    gitRun(repoRoot, ['worktree', 'remove', '--force', wt], { repoRoot });
    gitRun(repoRoot, ['worktree', 'prune'], { repoRoot });
    prepareWorktreeRemoval(repoRoot, wt);
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ya no está */ }
  }
}