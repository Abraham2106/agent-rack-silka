// Enlace con el hub que sobrevive a cortes: si el hub se reinicia (token nuevo) o la
// conexión SSE se cae por inactividad, la siguiente llamada reconecta en vez de fallar
// para siempre con "fetch failed".

const READ_METHOD = /^(list|get|read|status|logs?|identity|ping)/i;
const READ_TOOL = /(_list|_status|_logs|_identity|list_available|_search|_state|_notes|_decisions|_changes)$/i;

/** Texto legible para errores de red: "fetch failed" no dice nada por sí solo. */
export function describeNetError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const where = cause?.address ? ` ${cause.address}${cause.port ? `:${cause.port}` : ''}` : '';
  if (code && !msg.includes(code)) return `${msg} (${code}${where})`;
  return msg;
}

/** La petición nunca llegó al hub: reintentar no puede duplicar nada. */
export function isNotSentError(err) {
  const code = err?.cause?.code || err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  const msg = String(err?.message || err);
  return /not connected|no hay hub|transport (is )?closed|SSE error|Session not found|401|403|unauthorized/i.test(msg);
}

/** Error de conexión (no de la lógica de la herramienta). */
export function isConnectionError(err) {
  if (isNotSentError(err)) return true;
  const code = err?.cause?.code || err?.code;
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED'].includes(code)) return true;
  return /fetch failed|terminated|socket hang up|other side closed|connection closed|network/i.test(String(err?.message || err));
}

function isReadCall(method, args) {
  if (READ_METHOD.test(method)) return true;
  if (method === 'callTool') {
    const name = typeof args[0] === 'string' ? args[0] : args[0]?.name;
    return READ_TOOL.test(String(name || ''));
  }
  return false;
}

/**
 * Devuelve un objeto con los mismos métodos que el cliente que crea `open()`, pero que
 * reconecta solo. `open()` debe devolver un cliente ya conectado (con `close()`).
 * Reintenta una vez tras reconectar si la petición no llegó al hub, o si es de lectura.
 */
export function createHubLink(open, { onState } = {}) {
  let client = null;
  let opening = null;
  let closed = false;

  async function current() {
    if (closed) throw new Error('El enlace con el hub está cerrado.');
    if (client) return client;
    if (!opening) {
      opening = (async () => {
        try {
          client = await open();
          onState?.({ ok: true });
          return client;
        } finally {
          opening = null;
        }
      })();
    }
    return opening;
  }

  async function drop() {
    const old = client;
    client = null;
    if (old) await old.close?.().catch(() => {});
  }

  async function call(method, args) {
    let c = await current();
    try {
      return await c[method](...args);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      onState?.({ ok: false, error: describeNetError(err) });
      await drop();
      if (!isNotSentError(err) && !isReadCall(method, args)) {
        throw new Error(`Se cortó la conexión con el hub durante ${method}; no se reintenta para no duplicarlo. ${describeNetError(err)}`);
      }
      c = await current();
      return c[method](...args);
    }
  }

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined; // no es una promesa
      if (prop === 'close') return async () => { closed = true; await drop(); };
      if (prop === 'reconnect') return async () => { await drop(); return current(); };
      if (prop === 'connect') return async () => { await current(); };
      if (typeof prop !== 'string') return undefined;
      return (...args) => call(prop, args);
    },
  });
}
