import { formatRuntimeError } from './errors.mjs';

// SEC-02: el permission model de Node 22 no corta la red. Además de denegar los módulos
// (sandbox-hook), se quitan los globales que la abren y los accesos a bindings internos.
// Se reemplazan por funciones que fallan con E_POLICY (un "is not defined" no explica el porqué).
const networkDenied = (name) => function denied() {
  const err = new Error(`E_POLICY: '${name}' (red) no permitido en Code Mode`);
  err.code = 'E_POLICY';
  throw err;
};
for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  try { Object.defineProperty(globalThis, name, { value: networkDenied(name), configurable: false, writable: false }); } catch { /* */ }
}
for (const name of ['Request', 'Response', 'Headers', 'FormData']) {
  try { delete globalThis[name]; } catch { /* no configurable */ }
}
for (const name of ['binding', '_linkedBinding', 'dlopen']) {
  try { Object.defineProperty(process, name, { value: undefined, configurable: false, writable: false }); } catch { /* */ }
}

/** Los Error no sobreviven al IPC (se serializan sin message): se envían como objeto plano. */
function plainError(err) {
  // Un acceso denegado por el permission model es una violación de política (FR-CM-05: E_POLICY).
  if (err?.code === 'ERR_ACCESS_DENIED') {
    return { code: 'E_POLICY', message: `E_POLICY: acceso a ${err.permission || 'recurso del sistema'} no permitido en Code Mode (${err.message})` };
  }
  const base = formatRuntimeError(err);
  return { ...base, code: base?.code, message: base?.message ?? String(err) };
}

const TOP = new Set(['launch', 'wait', 'waitAll', 'status', 'card', 'get', 'send', 'cancel']);
const NS = new Set(['plan', 'state', 'memory', 'agents', 'review', 'merge']);

let invokeSeq = 0;
const pending = new Map();

function makeNamespace(path) {
  return new Proxy({}, {
    get(_, method) {
      if (typeof method !== 'string') return undefined;
      return (...args) => invokeApi([...path, method], args);
    },
  });
}

function invokeApi(path, args) {
  const id = ++invokeSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send?.({ type: 'api', id, path, args });
  });
}

const silka = new Proxy({}, {
  get(_, key) {
    if (typeof key !== 'string') return undefined;
    if (TOP.has(key)) return (...args) => invokeApi([key], args);
    if (NS.has(key)) return makeNamespace([key]);
    return undefined;
  },
});

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'api-result') {
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.ok) slot.resolve(msg.value);
    else slot.reject(Object.assign(new Error(msg.error?.message || 'Error en API'), msg.error || {}));
    return;
  }
  if (msg.type === 'run') {
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const fn = new AsyncFunction('silka', String(msg.code || ''));
      const value = await fn(silka);
      process.send?.({ type: 'done', value });
    } catch (err) {
      process.send?.({ type: 'error', error: plainError(err) });
    }
  }
});