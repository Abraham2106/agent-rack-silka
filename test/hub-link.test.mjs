import test from 'node:test';
import assert from 'node:assert/strict';
import { createHubLink, describeNetError, isConnectionError } from '../src/silka/hub-link.mjs';

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 8987 } });
const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

function fakeHub(script) {
  const opened = [];
  const open = async () => {
    const n = opened.length;
    const client = {
      closed: false,
      async close() { client.closed = true; },
      async listSessions() { return script.listSessions(n); },
      async sendInput(id, text) { return script.sendInput(n, id, text); },
      async callTool(params) { return script.callTool(n, params); },
    };
    opened.push(client);
    return client;
  };
  return { open, opened };
}

test('HL-01 hub reiniciado: reconecta y reintenta (la petición no llegó)', async () => {
  const hub = fakeHub({ listSessions: (n) => { if (n === 0) throw refused(); return ['ok']; } });
  const link = createHubLink(hub.open);
  assert.deepEqual(await link.listSessions(), ['ok']);
  assert.equal(hub.opened.length, 2);
  assert.equal(hub.opened[0].closed, true);
});

test('HL-02 corte a mitad de una escritura: no se reintenta (evita duplicar)', async () => {
  let sends = 0;
  const hub = fakeHub({ sendInput: (n) => { sends += 1; if (n === 0) throw reset(); return 'enviado'; }, listSessions: () => [] });
  const link = createHubLink(hub.open);
  await assert.rejects(link.sendInput('s1', 'hola'), /no se reintenta/);
  assert.equal(sends, 1);
  assert.equal(await link.sendInput('s1', 'hola'), 'enviado', 'la siguiente llamada usa una conexión nueva');
  assert.equal(hub.opened.length, 2);
});

test('HL-03 corte en una lectura: se reintenta', async () => {
  const hub = fakeHub({ listSessions: (n) => { if (n === 0) throw reset(); return [1]; } });
  assert.deepEqual(await createHubLink(hub.open).listSessions(), [1]);
});

test('HL-04 herramientas de lectura por callTool se reintentan; las de escritura no', async () => {
  const hub = fakeHub({ callTool: (n, p) => { if (n === 0 || (n === 1 && p.name === 'agent_session_send')) throw reset(); return p.name; } });
  const link = createHubLink(hub.open);
  assert.equal(await link.callTool({ name: 'agent_session_list', arguments: {} }), 'agent_session_list');
  await assert.rejects(link.callTool({ name: 'agent_session_send', arguments: {} }), /no se reintenta/);
});

test('HL-05 un error de la herramienta no es de conexión: no reconecta', async () => {
  const hub = fakeHub({ listSessions: () => { throw new Error('Session abc not found in agent'); } });
  const link = createHubLink(hub.open);
  await assert.rejects(link.listSessions(), /not found in agent/);
  assert.equal(hub.opened.length, 1);
});

test('HL-06 llamadas simultáneas comparten una sola reconexión', async () => {
  const hub = fakeHub({ listSessions: () => [] });
  const link = createHubLink(hub.open);
  await Promise.all([link.listSessions(), link.listSessions(), link.listSessions()]);
  assert.equal(hub.opened.length, 1);
});

test('HL-07 el mensaje explica el "fetch failed"', () => {
  assert.equal(describeNetError(refused()), 'fetch failed (ECONNREFUSED 127.0.0.1:8987)');
  assert.equal(isConnectionError(new Error('Session abc not found in agent')), false);
  assert.equal(isConnectionError(refused()), true);
});

test('HL-08 hub caído del todo: error claro, sin bucle', async () => {
  let opens = 0;
  const link = createHubLink(async () => { opens += 1; throw new Error('No hay hub. corre: silka hub'); });
  await assert.rejects(link.listSessions(), /No hay hub/);
  assert.equal(opens, 1);
});
