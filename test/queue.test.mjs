import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchOnce } from '../src/silka/dispatch.mjs';
import {
  clearQueue,
  completeDelivery,
  enqueueMessage,
  formatQueueDelivery,
  listQueue,
  queuePath,
  takeForDelivery,
} from '../src/silka/queue.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-queue-'));
process.env.SILKA_CONFIG_DIR = root;

const sessionId = '99999999-9999-9999-9999-999999999999';

function idle(turnCount) {
  return { sessionId, status: 'completed', turnCount, agentId: 'opencode' };
}

test('la cola persiste, agrupa y se entrega una sola vez', async () => {
  const first = enqueueMessage(sessionId, { author: 'claude', text: 'primero' });
  const second = enqueueMessage(sessionId, { author: 'tú', text: 'segundo' });
  const disk = JSON.parse(fs.readFileSync(queuePath(sessionId), 'utf8'));
  assert.deepEqual(disk.messages.map((item) => item.text), ['primero', 'segundo']);
  assert.deepEqual(listQueue(sessionId).map((item) => item.id), [first.id, second.id]);
  assert.equal(formatQueueDelivery(listQueue(sessionId)), 'claude: primero\n\ntú: segundo');

  const seen = [];
  const client = {
    async listSessions() { return [idle(client.turn)]; },
    async sendInput(_id, text) { seen.push(text); client.turn += 1; },
    turn: 1,
  };
  assert.equal(await dispatchOnce(client), 1);
  assert.deepEqual(seen, ['claude: primero\n\ntú: segundo']);
  assert.equal(listQueue(sessionId).length, 0);
  assert.equal(await dispatchOnce(client), 0);
  assert.equal(seen.length, 1);

  const extra = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  enqueueMessage(extra, { author: 'tú', text: 'uno' });
  enqueueMessage(extra, { author: 'tú', text: 'dos' });
  const batch = takeForDelivery(extra, { turnCount: 3 });
  assert.deepEqual(batch.map((item) => item.text), ['uno', 'dos']);
  const again = takeForDelivery(extra, { turnCount: 3 });
  assert.deepEqual(again.map((item) => item.id), batch.map((item) => item.id));
  const advanced = takeForDelivery(extra, { turnCount: 4 });
  assert.deepEqual(advanced, []);
  assert.equal(listQueue(extra).length, 0);

  const retry = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  enqueueMessage(retry, { author: 'tú', text: 'sigue' });
  const claimed = takeForDelivery(retry, { turnCount: 0 });
  assert.equal(claimed.length, 1);
  const mid = JSON.parse(fs.readFileSync(queuePath(retry), 'utf8'));
  assert.equal(mid.messages[0].status, 'delivering');
  completeDelivery(retry, claimed.map((item) => item.id));
  assert.equal(listQueue(retry).length, 0);
  assert.equal(clearQueue(sessionId), 0);
});

test('cola de una sesión que el hub ya no conoce: se marca no entregada y avisa', async () => {
  const { enqueueMessage, listQueue, clearQueue } = await import('../src/silka/queue.mjs');
  const { dispatchOnce } = await import('../src/silka/dispatch.mjs');
  const id = `huerfana-${process.pid}-${Date.now()}`;
  enqueueMessage(id, { author: 'tú', text: 'hola' });
  const sent = await dispatchOnce({ listSessions: async () => [], sendInput: async () => { throw new Error('no debería llamarse'); } });
  assert.equal(sent, 0);
  const [msg] = listQueue(id);
  assert.equal(msg.status, 'failed');
  assert.match(msg.error, /ya no existe en el hub/);
  clearQueue(id);
});

test('si reanudar falla, el lote queda como no entregado (no se reintenta en bucle)', async () => {
  const { enqueueMessage, listQueue, clearQueue } = await import('../src/silka/queue.mjs');
  const { dispatchOnce } = await import('../src/silka/dispatch.mjs');
  const id = `falla-${process.pid}-${Date.now()}`;
  enqueueMessage(id, { author: 'tú', text: 'hola' });
  const client = { listSessions: async () => [{ sessionId: id, status: 'completed', turnCount: 1 }], sendInput: async () => { throw new Error('resume roto'); } };
  await dispatchOnce(client);
  const [msg] = listQueue(id);
  assert.equal(msg.status, 'failed');
  assert.match(msg.error, /resume roto/);
  assert.equal(await dispatchOnce(client), 0);
  clearQueue(id);
});

test('si el hub se reinicia al entregar, el mensaje vuelve a la cola y llega tras reconectar', async () => {
  const id = `corte-${process.pid}-${Date.now()}`;
  enqueueMessage(id, { author: 'tú', text: 'no te pierdas' });
  const sessions = async () => [{ sessionId: id, status: 'completed', turnCount: 1 }];
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const down = { listSessions: sessions, sendInput: async () => { throw refused; } };
  await assert.rejects(dispatchOnce(down), /fetch failed/);
  assert.equal(listQueue(id)[0].status, 'pending', 'no se marca como fallido');
  const got = [];
  const up = { listSessions: sessions, sendInput: async (_s, text) => { got.push(text); } };
  assert.equal(await dispatchOnce(up), 1);
  assert.match(got[0], /no te pierdas/);
  clearQueue(id);
});
