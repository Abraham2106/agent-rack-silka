import { spawnSync } from 'node:child_process';
import { silkaError } from '../codemode/errors.mjs';

/** SEC-07: solo comandos declarados en la tarea, nunca sugerencias del agente. */
export function runVerifyCommands(cwd, commands, { timeoutMs = 120_000, env = {} } = {}) {
  const logs = [];
  let ok = true;
  for (const cmd of commands || []) {
    const started = Date.now();
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const shellArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', cmd]
      : ['-c', cmd];
    const r = spawnSync(shell, shellArgs, {
      cwd,
      encoding: 'utf8',
      timeout: Math.max(1000, timeoutMs - (Date.now() - started)),
      env: { ...process.env, ...env },
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
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

export function assertVerifyDeclared(commands) {
  if (!Array.isArray(commands) || !commands.length) {
    throw silkaError('E_TASK_INVALID', 'verify no tiene comandos.');
  }
  return commands;
}