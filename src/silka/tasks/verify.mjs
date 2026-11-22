import { spawnSync } from 'node:child_process';
import { silkaError } from '../codemode/errors.mjs';
import { harnessFreeEnv } from '../hub.mjs';
import { writeTaskLog } from './log-store.mjs';
import { expandCommand, shellInvocation } from './recipe.mjs';

/**
 * Ejecuta un comando de shell en cwd (verify / accept.cmd).
 * En Windows usa windowsVerbatimArguments para que cmd.exe no rompa comillas internas.
 * Con `shell` (receta del workspace) usa ese shell y expande `${NAME}` con `env` antes de lanzarlo.
 */
export function spawnShellCommand(cwd, cmd, { timeoutMs = 120_000, env = {}, shell = null } = {}) {
  const started = Date.now();
  const mergedEnv = { ...harnessFreeEnv(process.env), ...env };
  if (shell) {
    const inv = shellInvocation(shell, expandCommand(cmd, env));
    return spawnSync(inv.file, inv.args, {
      cwd,
      encoding: 'utf8',
      timeout: Math.max(1000, timeoutMs - (Date.now() - started)),
      env: mergedEnv,
      windowsHide: true,
      windowsVerbatimArguments: inv.verbatim,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
      cwd,
      encoding: 'utf8',
      timeout: Math.max(1000, timeoutMs - (Date.now() - started)),
      env: mergedEnv,
      windowsHide: true,
      windowsVerbatimArguments: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  return spawnSync('sh', ['-c', cmd], {
    cwd,
    encoding: 'utf8',
    timeout: Math.max(1000, timeoutMs - (Date.now() - started)),
    env: mergedEnv,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** SEC-07: solo comandos declarados en la tarea, nunca sugerencias del agente. */
export function runVerifyCommands(cwd, commands, { timeoutMs = 120_000, env = {}, shell = null } = {}) {
  const logs = [];
  let ok = true;
  for (const cmd of commands || []) {
    const r = spawnShellCommand(cwd, cmd, { timeoutMs, env, shell });
    const block = [
      `$ ${cmd}`,
      `exit: ${r.status ?? '?'}`,
      String(r.stdout || ''),
      String(r.stderr || ''),
    ].join('\n');
    logs.push(block);
    if (r.status !== 0) {
      ok = false;
      break;
    }
  }
  return { ok, log: logs.join('\n---\n') };
}

/** Ejecuta verify con evidencia por comando (comando, salida, duración, ref). */
export function runVerifyWithEvidence(repoRoot, taskId, cwd, commands, { timeoutMs = 120_000, env = {}, shell = null } = {}) {
  const items = [];
  const blocks = [];
  let allOk = true;
  let idx = 0;
  for (const cmd of commands || []) {
    const started = Date.now();
    const r = spawnShellCommand(cwd, cmd, { timeoutMs, env, shell });
    const durationMs = Date.now() - started;
    const block = [
      `$ ${cmd}`,
      `exit: ${r.status ?? '?'}`,
      String(r.stdout || ''),
      String(r.stderr || ''),
    ].join('\n');
    blocks.push(block);
    const ref = writeTaskLog(repoRoot, taskId, `verify-${idx}`, block);
    const itemOk = r.status === 0;
    items.push({
      kind: 'verify',
      cmd,
      exitCode: r.status ?? null,
      durationMs,
      ok: itemOk,
      ref,
    });
    if (!itemOk) {
      allOk = false;
      break;
    }
    idx += 1;
  }
  const combined = blocks.join('\n---\n');
  const verifyRef = writeTaskLog(repoRoot, taskId, 'verify', combined);
  return { ok: allOk, items, verifyRef, log: combined };
}

export function assertVerifyDeclared(commands, { allowNoVerify } = {}) {
  if (allowNoVerify) return commands || [];
  if (!Array.isArray(commands) || !commands.length) {
    throw silkaError('E_TASK_INVALID', 'verify no tiene comandos.');
  }
  return commands;
}