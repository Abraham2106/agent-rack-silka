import { isBusy } from './format.mjs';
import { completeDelivery, failDelivery, formatDelivery, listQueue, queuedSessionIds, releaseDelivery, takeForDelivery } from './queue.mjs';
import { appendNote } from './notes.mjs';
import { describeNetError, isNotSentError } from './hub-link.mjs';

function warn(sessionId, text) {
  try { appendNote({ sessionId, text, kind: 'entrega-fallida' }); } catch { /* la nota es opcional */ }
}

function stillRunning(message) {
  return /is still (running|cancelling)|still running/i.test(message);
}

/**
 * Cuando una sesión no está en un turno, manda toda su cola en un solo
 * sendInput. Cada mensaje tiene id: si este proceso se cae a medias, el
 * siguiente arranque retoma el lote o lo da por entregado si el turno ya avanzó.
 */
export async function dispatchOnce(client) {
  const list = await client.listSessions();
  const sessions = Array.isArray(list) ? list : [];
  let sent = 0;
  for (const session of sessions) {
    if (!session?.sessionId || session.status === 'cancelled' || isBusy(session.status)) continue;
    const turnCount = Number.isInteger(session.turnCount) ? session.turnCount : 0;
    const batch = takeForDelivery(session.sessionId, { turnCount });
    if (!batch.length) continue;
    const text = formatDelivery(batch);
    const ids = batch.map((message) => message.id);
    if (!text) {
      completeDelivery(session.sessionId, ids);
      continue;
    }
    try {
      await client.sendInput(session.sessionId, text);
      completeDelivery(session.sessionId, ids);
      sent += 1;
    } catch (err) {
      const detail = describeNetError(err);
      if (stillRunning(detail)) { releaseDelivery(session.sessionId, ids); continue; }
      if (isNotSentError(err)) {
        // El mensaje no llegó al hub (se reinició o se cortó el SSE): vuelve a la cola y
        // el ciclo de fuera reconecta. Antes se daba por fallido y se perdía.
        releaseDelivery(session.sessionId, ids);
        throw err;
      }
      // Antes solo iba a stderr. Ahora queda en el chat (✗) y como nota para el manager.
      console.error(`cola ${String(session.sessionId).slice(0, 8)}: ${detail}`);
      failDelivery(session.sessionId, ids, detail);
      warn(session.sessionId, `No se pudo entregar ${ids.length} mensaje(s) a ${String(session.sessionId).slice(0, 8)}: ${detail}`);
    }
  }
  // Colas de sesiones que el hub ya no conoce (p. ej. se reinició): se marcan y se avisa,
  // en vez de esperar para siempre.
  const known = new Set(sessions.map((s) => s?.sessionId).filter(Boolean));
  for (const id of queuedSessionIds()) {
    if (known.has(id)) continue;
    const ids = listQueue(id).filter((m) => m.status === 'pending' || m.status === 'delivering').map((m) => m.id);
    if (!ids.length) continue;
    const reason = 'la sesión ya no existe en el hub (¿se reinició?); vuelve a enviarlo a una sesión nueva';
    failDelivery(id, ids, reason);
    warn(id, `${ids.length} mensaje(s) en cola para ${id.slice(0, 8)} no se entregaron: ${reason}.`);
  }
  return sent;
}

/** Corre al lado del hub. `readRuntime` y `connect` los pone silka hub. */
export function startQueueDispatcher({ port, readRuntime, connect, intervalMs = 300 } = {}) {
  let client = null;
  let token = '';
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const runtime = readRuntime?.();
      if (!runtime?.token) return;
      if (!client || token !== runtime.token) {
        if (client) await client.close().catch(() => {});
        token = runtime.token;
        client = await connect(runtime);
      }
      if (client) await dispatchOnce(client);
    } catch {
      if (client) await client.close().catch(() => {});
      client = null;
      token = '';
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    if (client) await client.close().catch(() => {});
    client = null;
  };
}
