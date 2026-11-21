import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { runVerifyCommands } from './verify.mjs';
import { writeTaskLog } from './log-store.mjs';

function realPathSafe(p) {
  try {
    if (typeof fs.realpathSync.native === 'function') return fs.realpathSync.native(p);
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function assertInsideRoot(rootReal, targetReal, label) {
  const rel = path.relative(rootReal, targetReal);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw silkaError('E_POLICY', `Ruta fuera del worktree: ${label}`);
  }
}

function resolveInWorktree(worktree, relPath) {
  const root = path.resolve(worktree);
  const abs = path.resolve(root, String(relPath));
  const rel = path.relative(root, abs);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw silkaError('E_POLICY', `Ruta fuera del worktree: ${relPath}`);
  }
  const rootReal = realPathSafe(root);
  if (fs.existsSync(abs)) {
    const targetReal = realPathSafe(abs);
    assertInsideRoot(rootReal, targetReal, relPath);
  }
  return abs;
}

function checkGrep(worktree, { pattern, path: relPath, absent } = {}) {
  const abs = resolveInWorktree(worktree, relPath);
  const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const re = new RegExp(pattern, 'm');
  const found = re.test(text);
  const ok = absent ? !found : found;
  return { ok, detail: absent ? `sin coincidencia: ${pattern}` : `grep: ${pattern}` };
}

function checkFile(worktree, { path: relPath, exists } = {}) {
  const abs = resolveInWorktree(worktree, relPath);
  const present = fs.existsSync(abs);
  const want = exists !== false;
  const ok = want ? present : !present;
  return { ok, detail: want ? `existe: ${relPath}` : `ausente: ${relPath}` };
}

/**
 * SEC-07: solo criterios declarados; grep/file sin shell.
 * @returns {{ ok: boolean, items: object[] }}
 */
export function runAcceptCriteria(repoRoot, taskId, worktree, criteria, { timeoutMs, env } = {}) {
  const list = Array.isArray(criteria) ? criteria : [];
  const items = [];
  let allOk = true;
  let idx = 0;
  for (const raw of list) {
    const started = Date.now();
    let entry;
    if (raw?.cmd) {
      const cmd = String(raw.cmd);
      const r = runVerifyCommands(worktree, [cmd], { timeoutMs, env });
      const durationMs = Date.now() - started;
      const ref = writeTaskLog(repoRoot, taskId, `accept-${idx}`, r.log);
      const exitMatch = /exit: (\d+)/.exec(r.log);
      entry = {
        kind: 'accept',
        type: 'cmd',
        cmd,
        exitCode: exitMatch ? Number(exitMatch[1]) : null,
        durationMs,
        ok: r.ok,
        ref,
      };
    } else if (raw?.grep) {
      const r = checkGrep(worktree, raw.grep);
      entry = {
        kind: 'accept',
        type: 'grep',
        pattern: raw.grep.pattern,
        path: raw.grep.path,
        absent: Boolean(raw.grep.absent),
        durationMs: Date.now() - started,
        ok: r.ok,
        ref: null,
        detail: r.detail,
      };
    } else if (raw?.file) {
      const r = checkFile(worktree, raw.file);
      entry = {
        kind: 'accept',
        type: 'file',
        path: raw.file.path,
        exists: raw.file.exists !== false,
        durationMs: Date.now() - started,
        ok: r.ok,
        ref: null,
        detail: r.detail,
      };
    } else {
      throw silkaError('E_TASK_INVALID', 'Criterio accept no reconocido.');
    }
    items.push(entry);
    if (!entry.ok) allOk = false;
    idx += 1;
  }
  return { ok: allOk, items };
}