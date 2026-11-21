import { isBusy } from './format.mjs';
import { completeDelivery, formatQueueDelivery, releaseDelivery, takeForDelivery } from './queue.mjs';

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
    const text = formatQueueDelivery(batch);
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
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`cola ${String(session.sessionId).slice(0, 8)}: ${detail}`);
      releaseDelivery(session.sessionId, ids);
      if (stillRunning(detail)) continue;
    }
  }
  return sent;
}

/** Corre al lado del hub. `readRuntime` y `connect` los pone silka hub. */
export function startQueueDispatcher({ port, readRuntime, connect, intervalMs = 1000 } = {}) {
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
