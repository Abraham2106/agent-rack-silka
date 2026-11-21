// Corre el escaneo de workspaces fuera del hilo del TUI y guarda el último resultado.
import { Worker } from 'node:worker_threads';

const EMPTY = { hot: new Set(), board: null, clear: true };

export function createWorkspaceScanner({ onUpdate, everyMs = 3000, inline = null } = {}) {
  let latest = EMPTY;
  let busy = false;
  let lastAt = 0;
  let lastSig = '';
  let pending = null;
  let seq = 0;
  let worker = null;
  let closed = false;

  function accept(result) {
    busy = false;
    if (closed || !result || result.error) return;
    latest = { hot: new Set(result.hot || []), board: result.board ?? null, clear: Boolean(result.clear) };
    onUpdate?.();
    if (pending) { const next = pending; pending = null; run(next.job, next.sig); }
  }

  try {
    if (!inline) {
      worker = new Worker(new URL('./workspace-worker.mjs', import.meta.url));
      worker.unref();
      worker.on('message', accept);
      worker.on('error', () => { worker = null; busy = false; });
    }
  } catch {
    worker = null;
  }

  async function run(job, sig) {
    busy = true;
    lastAt = Date.now();
    lastSig = sig;
    if (worker) {
      worker.postMessage({ id: ++seq, ...JSON.parse(JSON.stringify(job)) });
      return;
    }
    // Sin worker (entorno raro): mismo trabajo, pero al menos espaciado.
    const scan = inline || (await import('./workspace-worker.mjs')).scanWorkspaces;
    setTimeout(() => {
      try { accept(scan(job)); } catch { busy = false; }
    }, 0);
  }

  return {
    /** Pide un escaneo si toca: cambió un estado o pasaron `everyMs`. */
    request(job, sig) {
      if (closed) return;
      const due = sig !== lastSig || Date.now() - lastAt >= everyMs;
      if (!due) return;
      if (busy) { if (sig !== lastSig) pending = { job, sig }; return; }
      run(job, sig);
    },
    latest: () => latest,
    async close() {
      closed = true;
      if (worker) await worker.terminate().catch(() => {});
    },
  };
}
