import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatRuntimeError, isSilkaError, silkaError } from './errors.mjs';
import { HEAP_MB, MAX_IPC_CALLS, wallMs } from './limits.mjs';
import { validateIpcPayload } from './api-schema.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(DIR, 'sandbox-child.mjs');
const PRELOAD = path.join(DIR, 'sandbox-preload.mjs');
// Con --permission y sin --allow-fs-read, Node no puede ni cargar el propio sandbox.
// Se permite leer SOLO sus archivos (ninguna otra ruta, ninguna escritura).
const SANDBOX_FILES = ['sandbox-child.mjs', 'sandbox-preload.mjs', 'sandbox-hook.mjs', 'errors.mjs']
  .map((name) => path.join(DIR, name));

export class SandboxRunner {
  /**
   * @param {{ onApiCall: (path: string[], args: unknown[]) => Promise<unknown>, timeoutSeconds?: number, heapMb?: number, ipcCallLimit?: number }} opts
   */
  constructor(opts) {
    this.onApiCall = opts.onApiCall;
    this.timeoutSeconds = opts.timeoutSeconds;
    this.heapMb = opts.heapMb ?? HEAP_MB;
    this.ipcCallLimit = opts.ipcCallLimit ?? MAX_IPC_CALLS;
    this.child = null;
    this.ipcCalls = 0;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
    }
  }

  async run(code) {
    const deadline = Date.now() + wallMs(this.timeoutSeconds);
    return new Promise((resolve, reject) => {
      const child = fork(CHILD, [], {
        execArgv: [
          '--permission',
          ...SANDBOX_FILES.map((file) => `--allow-fs-read=${file}`),
          `--max-old-space-size=${this.heapMb}`,
          '--import',
          pathToFileURL(PRELOAD).href, // en Windows --import exige una URL file://, no 'C:…'
        ],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, SILKA_SANDBOX: '1' },
      });
      this.child = child;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearInterval(watch);
        fn(value);
      };

      const watch = setInterval(() => {
        if (Date.now() > deadline) {
          this.cancel();
          finish(reject, silkaError('E_LIMIT', 'Tiempo de ejecución agotado.', { limit: 'wallSeconds', max: wallMs(this.timeoutSeconds) / 1000 }));
        }
      }, 250);

      child.on('message', async (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'done') {
          child.kill();
          finish(resolve, msg.value);
          return;
        }
        if (msg.type === 'error') {
          child.kill();
          finish(reject, msg.error || silkaError('E_RUNTIME', 'Error en sandbox'));
          return;
        }
        if (msg.type === 'api') {
          this.ipcCalls += 1;
          if (this.ipcCalls > this.ipcCallLimit) {
            this.cancel();
            finish(reject, silkaError('E_LIMIT', 'Demasiadas llamadas IPC.', { limit: 'ipcCalls', max: this.ipcCallLimit, value: this.ipcCalls }));
            return;
          }
          try {
            validateIpcPayload(msg);
            const value = await this.onApiCall(msg.path, msg.args);
            child.send({ type: 'api-result', id: msg.id, ok: true, value });
          } catch (err) {
            const error = isSilkaError(err)
              ? err
              : formatRuntimeError(err);
            child.send({ type: 'api-result', id: msg.id, ok: false, error });
          }
        }
      });

      child.on('error', (err) => {
        finish(reject, formatRuntimeError(err));
      });

      child.on('close', (code, signal) => { // 'close' espera a que stderr se vacíe (con 'exit' se perdía el detalle)
        if (settled) return;
        if (this.cancelled) {
          finish(reject, silkaError('E_LIMIT', 'Ejecución cancelada.'));
          return;
        }
        if (code !== 0) {
          // FR-CM-05: el error vuelve íntegro (antes se descartaba stderr y solo quedaba el código).
          const detail = stderrText.trim().split('\n').slice(-8).join('\n');
          finish(reject, silkaError('E_RUNTIME', `El sandbox terminó con código ${code}${signal ? ` (${signal})` : ''}.${detail ? `\n${detail}` : ''}`));
        }
      });
      let stderrText = '';
      child.stderr?.on('data', (chunk) => { stderrText = (stderrText + chunk).slice(-8000); });

      child.send({ type: 'run', code });
    });
  }
}

/** Ejecuta un snippet de prueba de seguridad en el sandbox (sin API). */
export async function runSandboxSnippet(code, { timeoutSeconds = 15, heapMb = HEAP_MB, ipcCallLimit = 5 } = {}) {
  const runner = new SandboxRunner({
    timeoutSeconds,
    heapMb,
    ipcCallLimit,
    onApiCall: async () => {
      throw silkaError('E_POLICY', 'Llamada API inesperada en snippet de seguridad.');
    },
  });
  try {
    return await runner.run(code);
  } catch (err) {
    throw isSilkaError(err) ? err : formatRuntimeError(err);
  }
}