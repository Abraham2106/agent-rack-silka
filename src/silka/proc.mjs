import { execFile } from 'node:child_process';

/** Mata el proceso y sus hijos. En Windows, taskkill /T; con force, también /F. */
export function signalProcessTree(pid, { force = false } = {}) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(id), '/T'];
    if (force) args.push('/F');
    execFile('taskkill', args, { windowsHide: true }, () => {});
    return;
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(-id, signal);
  } catch {
    try { process.kill(id, signal); } catch { /* ya terminó */ }
  }
}
