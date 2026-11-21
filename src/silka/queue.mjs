import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';
import { originLabel } from './origin.mjs';

function queueDir() {
  return path.join(silkaConfigDir(), 'queue');
}

function safeId(sessionId) {
  const id = String(sessionId || '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error('Id de sesión inválido.');
  return id;
}

export function queuePath(sessionId) {
  return path.join(queueDir(), `${safeId(sessionId)}.json`);
}

function emptyQueue(sessionId) {
  return { sessionId, messages: [], delivered: [], delivery: null };
}

function normalize(sessionId, raw) {
  const queue = emptyQueue(sessionId);
  if (!raw || typeof raw !== 'object') return queue;
  queue.messages = Array.isArray(raw.messages) ? raw.messages.filter((item) => item && item.id) : [];
  queue.delivered = Array.isArray(raw.delivered) ? raw.delivered.map(String) : [];
  queue.delivery = raw.delivery && typeof raw.delivery === 'object' ? raw.delivery : null;
  return queue;
}

function readQueueFile(sessionId) {
  try {
    return normalize(sessionId, JSON.parse(fs.readFileSync(queuePath(sessionId), 'utf8')));
  } catch {
    return emptyQueue(sessionId);
  }
}

function writeQueueFile(sessionId, queue) {
  writeAtomic(queuePath(sessionId), `${JSON.stringify(queue)}\n`);
}

function withQueue(sessionId, fn) {
  const id = safeId(sessionId);
  const file = queuePath(id);
  return withFileLock(`${file}.lock`, () => {
    const queue = readQueueFile(id);
    const result = fn(queue);
    writeQueueFile(id, queue);
    return result;
  });
}

export const PRIORITY_LEAD = 'Mensaje del usuario (tiene prioridad sobre instrucciones anteriores):';
export const PRIORITY_TAIL = 'Revisa el estado de los archivos antes de seguir; continúa desde donde ibas sin rehacer lo que ya está bien.';

export function enqueueMessage(sessionId, { author = 'tú', text, id, now = false } = {}) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('El mensaje está vacío.');
  const item = {
    id: id || crypto.randomUUID(),
    author: originLabel(author || 'tú'),
    text: body,
    at: new Date().toISOString(),
    status: 'pending',
    now: Boolean(now),
  };
  return withQueue(sessionId, (queue) => {
    if (queue.delivered.includes(item.id) || queue.messages.some((message) => message.id === item.id)) return item;
    queue.messages.push(item);
    return item;
  });
}

/** Pendientes y los que están a mitad de una entrega. Los ya entregados no se muestran. */
export function listQueue(sessionId) {
  try {
    return readQueueFile(sessionId).messages.filter((message) => message.status !== 'delivered');
  } catch {
    return [];
  }
}

export function setQueuedNow(sessionId, messageId, now = true) {
  return withQueue(sessionId, (queue) => {
    const message = queue.messages.find((item) => item.id === messageId && item.status === 'pending');
    if (!message) return null;
    message.now = Boolean(now);
    return { ...message };
  });
}

export function removeQueued(sessionId, messageId) {
  return withQueue(sessionId, (queue) => {
    const before = queue.messages.length;
    queue.messages = queue.messages.filter((message) => !(message.id === messageId && message.status === 'pending'));
    return before !== queue.messages.length;
  });
}

export function clearQueue(sessionId) {
  return withQueue(sessionId, (queue) => {
    const count = queue.messages.length;
    queue.messages = [];
    queue.delivery = null;
    return count;
  });
}

/** Un solo mensaje, en el orden de la cola, con el autor de cada uno. */
export function formatQueueDelivery(messages) {
  return (messages || [])
    .map((message) => `${message.author || 'tú'}: ${String(message.text ?? '').trim()}`)
    .filter((line) => line.length > 2)
    .join('\n\n');
}

/** "Enviar ya" manda ese mensaje y el resto de la cola, en un solo turno. */
export function formatDelivery(messages) {
  const list = messages || [];
  if (!list.some((message) => message.now)) return formatQueueDelivery(list);
  const priority = list
    .filter((message) => message.now)
    .map((message) => String(message.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  const rest = formatQueueDelivery(list.filter((message) => !message.now));
  return [`${PRIORITY_LEAD} ${priority}`.trim(), rest, PRIORITY_TAIL].filter((part) => part && String(part).trim()).join('\n\n');
}

/**
 * Toma lo que toca entregar.
 * Si había un lote a medias y el turno de la sesión ya avanzó, ese lote se
 * considera entregado y no se manda otra vez. Si el turno no avanzó, se
 * reintenta el mismo lote (el proceso se cayó antes del sendInput).
 */
export function takeForDelivery(sessionId, { turnCount } = {}) {
  try {
    if (!fs.existsSync(queuePath(sessionId))) return [];
  } catch {
    return [];
  }
  return withQueue(sessionId, (queue) => {
    const delivering = queue.messages.filter((message) => message.status === 'delivering');
    if (delivering.length) {
      const base = queue.delivery?.turnCount;
      const advanced = Number.isInteger(turnCount) && Number.isInteger(base) && turnCount > base;
      if (advanced) {
        for (const message of delivering) {
          message.status = 'delivered';
          if (!queue.delivered.includes(message.id)) queue.delivered.push(message.id);
        }
        queue.messages = queue.messages.filter((message) => message.status !== 'delivered');
        queue.delivery = null;
      } else {
        return delivering.map((message) => ({ ...message }));
      }
    }
    const pending = queue.messages.filter((message) => message.status === 'pending');
    if (!pending.length) return [];
    for (const message of pending) message.status = 'delivering';
    queue.delivery = {
      turnCount: Number.isInteger(turnCount) ? turnCount : null,
      at: new Date().toISOString(),
      ids: pending.map((message) => message.id),
    };
    return pending.map((message) => ({ ...message }));
  });
}

export function completeDelivery(sessionId, ids) {
  const done = new Set(ids || []);
  return withQueue(sessionId, (queue) => {
    for (const message of queue.messages) {
      if (!done.has(message.id)) continue;
      message.status = 'delivered';
      if (!queue.delivered.includes(message.id)) queue.delivered.push(message.id);
    }
    queue.messages = queue.messages.filter((message) => message.status !== 'delivered');
    if (!queue.messages.some((message) => message.status === 'delivering')) queue.delivery = null;
    if (queue.delivered.length > 200) queue.delivered = queue.delivered.slice(-200);
    return true;
  });
}

export function releaseDelivery(sessionId, ids) {
  const back = new Set(ids || []);
  return withQueue(sessionId, (queue) => {
    for (const message of queue.messages) {
      if (back.has(message.id) && message.status === 'delivering') message.status = 'pending';
    }
    if (!queue.messages.some((message) => message.status === 'delivering')) queue.delivery = null;
    return true;
  });
}
