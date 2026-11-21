import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { silkaConfigDir } from '../paths.mjs';

/** Directorio vacío fuera del repo para core.hooksPath (SEC-06). */
export function emptyHooksDir() {
  const dir = path.join(silkaConfigDir(), 'git-empty-hooks');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } catch { /* sigue */ }
  }
  return dir;
}

/** Ejecuta git en `cwd` siempre con hooks desactivados (SEC-06). */
export function gitRun(cwd, args, { timeoutMs, repoRoot } = {}) {
  const hooks = emptyHooksDir();
  const gitArgs = ['-c', `core.hooksPath=${hooks}`, ...args];
  const r = spawnSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs ?? 120_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout,
    stderr,
    signal: r.signal,
  };
}

export function findGitRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function currentCommit(repoRoot) {
  const r = gitRun(repoRoot, ['rev-parse', 'HEAD'], { repoRoot });
  if (!r.ok) throw new Error(r.stderr || 'git rev-parse falló');
  return r.stdout.trim();
}

export function diffSummary(cwd, baseCommit, { repoRoot } = {}) {
  const root = repoRoot || findGitRoot(cwd) || cwd;
  const stat = gitRun(cwd, ['diff', '--stat', baseCommit], { repoRoot: root });
  const numstat = gitRun(cwd, ['diff', '--numstat', baseCommit], { repoRoot: root });
  const nameOnly = gitRun(cwd, ['diff', '--name-only', baseCommit], { repoRoot: root });
  const untracked = gitRun(cwd, ['ls-files', '--others', '--exclude-standard'], { repoRoot: root });
  const files = [...new Set([
    ...nameOnly.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    ...untracked.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  ])];
  let added = 0;
  let removed = 0;
  for (const line of numstat.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const a = Number(parts[0]);
    const d = Number(parts[1]);
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(d)) removed += d;
  }
  return { files, added, removed, statText: stat.stdout.trim() };
}