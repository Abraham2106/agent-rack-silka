import fs from 'node:fs';
import path from 'node:path';
import { gitRun } from './git.mjs';
import { prepareWorktreeRemoval } from './worktree-cleanup.mjs';

export function worktreePath(repoRoot, taskId) {
  return path.join(repoRoot, '.silka', 'worktrees', taskId);
}

export function branchName(taskId) {
  return `silka/${taskId}`;
}

export function createTaskWorktree(repoRoot, taskId, baseCommit) {
  const wt = worktreePath(repoRoot, taskId);
  const branch = branchName(taskId);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (fs.existsSync(wt)) {
    throw new Error(`El worktree ya existe: ${wt}`);
  }
  const r = gitRun(repoRoot, ['worktree', 'add', '-b', branch, wt, baseCommit], { repoRoot });
  if (!r.ok) throw new Error(r.stderr || r.stdout || 'git worktree add falló');
  return { worktreePath: wt, branch, baseCommit };
}

export function removeTaskWorktree(repoRoot, taskId) {
  const wt = worktreePath(repoRoot, taskId);
  if (!fs.existsSync(wt)) return;
  prepareWorktreeRemoval(repoRoot, wt);
  const r = gitRun(repoRoot, ['worktree', 'remove', '--force', wt], { repoRoot });
  if (!r.ok) {
    prepareWorktreeRemoval(repoRoot, wt);
    gitRun(repoRoot, ['worktree', 'prune'], { repoRoot });
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ya no está */ }
  }
  const branch = branchName(taskId);
  gitRun(repoRoot, ['branch', '-D', branch], { repoRoot });
}