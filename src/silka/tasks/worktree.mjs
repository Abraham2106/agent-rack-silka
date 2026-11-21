import fs from 'node:fs';
import path from 'node:path';
import { worktreesBase } from '../paths.mjs';
import { gitRun } from './git.mjs';
import { prepareWorktreeRemoval } from './worktree-cleanup.mjs';

/** Worktree de una tarea, fuera del repo (ver worktreesBase y BUG-06). */
export function worktreePath(repoRoot, taskId) {
  return path.join(worktreesBase(repoRoot), taskId);
}

export function branchName(taskId) {
  return `silka/${taskId}`;
}

/**
 * ¿Sigue siendo un worktree de git? Un worktree "perdido" (carpeta sin `.git`, o con un
 * `.git` que apunta a un gitdir borrado) no debe usarse: ahí un agente o un verify
 * operarían sobre lo que git encuentre más arriba.
 */
export function isValidWorktree(wt) {
  if (!wt) return false;
  try {
    const dotGit = path.join(wt, '.git');
    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return true;
    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!match) return false;
    const gitdir = path.resolve(wt, match[1].trim());
    return fs.existsSync(gitdir);
  } catch {
    return false;
  }
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

/**
 * Quita el worktree de una tarea. `wt` es la ruta guardada en la tarea (las tareas viejas
 * tienen worktrees dentro del repo); si falta, se usa la ruta actual.
 */
export function removeTaskWorktree(repoRoot, taskId, wt = worktreePath(repoRoot, taskId)) {
  if (fs.existsSync(wt)) {
    prepareWorktreeRemoval(repoRoot, wt);
    const r = gitRun(repoRoot, ['worktree', 'remove', '--force', wt], { repoRoot });
    if (!r.ok) {
      prepareWorktreeRemoval(repoRoot, wt);
      gitRun(repoRoot, ['worktree', 'prune'], { repoRoot });
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ya no está */ }
    }
  }
  const branch = branchName(taskId);
  gitRun(repoRoot, ['branch', '-D', branch], { repoRoot });
}
