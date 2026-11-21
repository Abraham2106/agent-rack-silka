import { execFile } from 'node:child_process';

/**
 * Windows: `start /b` y similares desprenden procesos que dejan de colgar del árbol en
 * cuanto su padre muere, y `taskkill /T` ya no los alcanza. Mientras el agente corre,
 * anotamos cada descendiente que aparece (sondeo cada `intervalMs`); al terminar se
 * matan también los que quedaron huérfanos. En macOS/Linux basta el grupo de procesos.
 */
export function trackDescendants(rootPid, { intervalMs = 2500 } = {}) {
  const seen = new Set();
  if (process.platform !== 'win32' || !Number(rootPid)) return { seen, stop() {} };
  const poll = () => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'],
    { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) return;
      const children = new Map();
      for (const line of String(stdout).split(/\r?\n/)) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!pid) continue;
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
      }
      // Desde la raíz y desde cada pid ya visto (sus hijos siguen siendo nuestros aunque el padre muera).
      const queue = [Number(rootPid), ...seen];
      while (queue.length) {
        for (const kid of children.get(queue.shift()) ?? []) {
          if (!seen.has(kid)) { seen.add(kid); queue.push(kid); }
        }
      }
    });
  };
  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref?.();
  return { seen, stop() { clearInterval(timer); } };
}

/** Mata (forzado) los pids anotados que sigan vivos. */
export function killTracked(tracker) {
  tracker.stop();
  for (const pid of tracker.seen) {
    try { process.kill(pid, 0); } catch { continue; }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  }
}

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
