// Regresión de openspec/specs/hub-connection/spec.md: una prueba por escenario HL-01..HL-08.
// Complementa test/hub-link.test.mjs con las comprobaciones que la spec pide y allí no se
// afirmaban (estados del enlace, número de intentos, cierre de la conexión rota, mensaje de
// error). También cubre la frontera de entorno: ninguna variable del arnés llega a los agentes
// (TH-11 en hub.test.mjs / TP-01 en specs/tui, compartidos por harnessFreeEnv).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHubLink, describeNetError, isConnectionError, isNotSentError } from '../src/silka/hub-link.mjs';
import { harnessFreeEnv } from '../src/silka/hub.mjs';

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 8987 } });
const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

function fakeHub(script) {
  const opened = [];
  const open = async () => {
    const n = opened.length;
    const client = {
      n,
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

test('HL-01 hub reiniciado: la petición falla y la siguiente reconecta con éxito', async () => {
  const states = [];
  const seen = [];
  const hub = fakeHub({
    listSessions(n) {
      seen.push(n);
      if (n === 0) throw refused();
      return ['sesion-viva'];
    },
  });
  const link = createHubLink(hub.open, { onState: (state) => states.push(state) });
  assert.deepEqual(await link.listSessions(), ['sesion-viva']);
  assert.deepEqual(seen, [0, 1], 'un solo reintento, en una conexión nueva');
  assert.equal(hub.opened.length, 2);
  assert.equal(hub.opened[0].closed, true, 'se cierra la conexión del hub caído');
  assert.equal(hub.opened[1].closed, false);
  assert.ok(states.some((s) => s.ok === false && /ECONNREFUSED/.test(s.error)), 'se informa del corte');
  assert.ok(states.some((s) => s.ok === true), 'se informa de la reconexión');
});

test('HL-02 escritura cortada: no se reintenta y el error lo indica', async () => {
  let sends = 0;
  const hub = fakeHub({
    sendInput(n) {
      sends += 1;
      if (n === 0) throw reset();
      return 'enviado';
    },
  });
  const link = createHubLink(hub.open);
  await assert.rejects(link.sendInput('s1', 'hola'), (err) => {
    assert.match(err.message, /no se reintenta/);
    assert.match(err.message, /ECONNRESET/);
    return true;
  });
  assert.equal(sends, 1, 'ni una escritura duplicada');
  assert.equal(hub.opened[0].closed, true, 'la conexión rota se descarta');
});

test('HL-03 lectura cortada: se reintenta en una conexión nueva', async () => {
  const seen = [];
  const hub = fakeHub({
    listSessions(n) {
      seen.push(n);
      if (n === 0) throw reset();
      return ['s1'];
    },
  });
  assert.deepEqual(await createHubLink(hub.open).listSessions(), ['s1']);
  assert.deepEqual(seen, [0, 1]);
  assert.notEqual(hub.opened[0], hub.opened[1]);
});

test('HL-04 callTool: la lectura se reintenta, la escritura cortada no', async () => {
  const calls = [];
  const hub = fakeHub({
    callTool(n, params) {
      calls.push([n, params.name]);
      if (n === 0) throw reset();
      if (n === 1 && params.name === 'agent_session_send') throw reset();
      return params.name;
    },
  });
  const link = createHubLink(hub.open);
  assert.equal(await link.callTool({ name: 'agent_session_list', arguments: {} }), 'agent_session_list');
  await assert.rejects(link.callTool({ name: 'agent_session_send', arguments: {} }), /no se reintenta/);
  assert.deepEqual(calls, [
    [0, 'agent_session_list'],
    [1, 'agent_session_list'],
    [1, 'agent_session_send'],
  ], 'la lectura se reintentó; la escritura se dejó fallar sin repetirse');
});

test('HL-05 error de la herramienta: no es de conexión y no reconecta', async () => {
  const hub = fakeHub({ listSessions() { throw new Error('Session abc not found in agent'); } });
  const link = createHubLink(hub.open);
  await assert.rejects(link.listSessions(), /not found in agent/);
  assert.equal(hub.opened.length, 1, 'los errores de dominio no reconectan');
});

test('HL-06 llamadas simultáneas: comparten una apertura y una reconexión', async () => {
  const hub = fakeHub({ listSessions: () => [] });
  const link = createHubLink(hub.open);
  await Promise.all(Array.from({ length: 5 }, () => link.listSessions()));
  assert.equal(hub.opened.length, 1, 'una sola conexión para todas las llamadas');
  await link.reconnect();
  assert.equal(hub.opened.length, 2, 'reconnect abre una conexión nueva');
});

test('HL-07 mensaje descriptivo: código y host:puerto, y clasificación del error', () => {
  assert.equal(describeNetError(refused()), 'fetch failed (ECONNREFUSED 127.0.0.1:8987)');
  assert.match(describeNetError(reset()), /ECONNRESET/);
  assert.equal(isNotSentError(refused()), true);
  assert.equal(isNotSentError(reset()), false);
  assert.equal(isConnectionError(refused()), true);
  assert.equal(isConnectionError(reset()), true);
  assert.equal(isConnectionError(new Error('Session abc not found in agent')), false);
});

test('HL-08 hub inexistente: error claro y un solo intento (sin bucle)', async () => {
  let opens = 0;
  const link = createHubLink(async () => {
    opens += 1;
    throw new Error('No hay hub. corre: silka hub');
  });
  await assert.rejects(link.listSessions(), /No hay hub/);
  assert.equal(opens, 1, 'no se vuelve a intentar abrir un hub que no existe');
});

test('TH-11/TP-01 el entorno a agentes no lleva variables del arnés', () => {
  const env = harnessFreeEnv({
    PATH: 'C:/bin',
    OPENAI_API_KEY: 'se-mantiene',
    CI: '1',
    CLAUDECODE: '1',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secreto',
    CLAUDE_CODE_USER_EMAIL: 'alguien@ejemplo.com',
    CLAUDE_AGENT_SDK_VERSION: '1',
    CLAUDE_PROJECT_DIR: 'C:/p',
    CLAUDE_PID: '42',
    SILKA_UI_NODE_ENV: '1',
    NODE_ENV: 'production',
  });
  assert.deepEqual(env, { PATH: 'C:/bin', OPENAI_API_KEY: 'se-mantiene' });
  assert.deepEqual(
    harnessFreeEnv({ NODE_ENV: 'development', PATH: 'C:/bin' }),
    { NODE_ENV: 'development', PATH: 'C:/bin' },
    'el NODE_ENV del usuario se conserva si no lo fijó el TUI',
  );
});
