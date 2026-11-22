import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiDispatcher } from '../src/silka/codemode/api-dispatch.mjs';
import { getStoredRef, resetOutputStore, storeExecutionResult } from '../src/silka/codemode/output-store.mjs';
import { SandboxRunner, runSandboxSnippet } from '../src/silka/codemode/runner.mjs';
import { searchSignatures } from '../src/silka/codemode/search.mjs';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { measureNfrTok01 } from '../src/silka/codemode/token-metrics.mjs';
import {
  eventsForTurn,
  lastAgentMessageFromEvents,
} from '../src/silka/codemode/wait-result.mjs';

async function expectDenied(code) {
  try {
    await runSandboxSnippet(code);
    assert.fail('se esperaba fallo de sandbox');
  } catch (err) {
    const message = err?.message || '';
    const policy = err?.code === 'E_POLICY'
      || /E_POLICY|ERR_ACCESS_DENIED|no permitido en Code Mode/i.test(message);
    assert.equal(policy, true, message);
  }
}

test('silka_search devuelve versión y fragmentos acotados', () => {
  const hit = searchSignatures('launch waitAll');
  assert.match(hit.version, /^\d+\.\d+\.\d+$/);
  assert.ok(hit.fragments.includes('launch'));
  assert.ok(hit.bytes <= 4096);
});

test('T-SEC-01 lectura de disco bloqueada (SEC-01)', async () => {
  await expectDenied(`
    const fs = await import('node:fs');
    return fs.readFileSync('package.json');
  `);
});

test('T-SEC-02 escritura en disco bloqueada (SEC-01)', async () => {
  await expectDenied(`
    const fs = await import('node:fs');
    fs.writeFileSync('evil.txt', 'x');
    return true;
  `);
});

test('T-SEC-03 child_process bloqueado (SEC-01)', async () => {
  await expectDenied(`
    const cp = await import('node:child_process');
    return cp.spawnSync('node', ['-v']);
  `);
});

test('T-SEC-04 net/http bloqueados (SEC-02)', async () => {
  await expectDenied(`await import('node:net');`);
  await expectDenied(`await import('node:http');`);
});

test('T-SEC-05 fetch bloqueado (SEC-02)', async () => {
  await expectDenied(`return await fetch('http://127.0.0.1');`);
});

test('T-SEC-06 vm e inspector bloqueados (SEC-02)', async () => {
  await expectDenied(`await import('node:vm');`);
  await expectDenied(`await import('node:inspector');`);
});

test('T-SEC-07 límite de llamadas IPC (SEC-03)', async () => {
  const runner = new SandboxRunner({
    timeoutSeconds: 30,
    ipcCallLimit: 8,
    onApiCall: async () => ({ sessionId: 'x', status: 'completed' }),
  });
  await assert.rejects(
    () => runner.run(`
      for (let i = 0; i < 20; i++) await silka.status('sess');
      return true;
    `),
    (err) => isSilkaError(err) && err.code === 'E_LIMIT' && /IPC/i.test(err.message),
  );
});

test('T-CM-03 salida grande por referencia y get idéntico', () => {
  resetOutputStore();
  const big = { blob: 'z'.repeat(60_000) };
  const packed = storeExecutionResult(big);
  assert.ok(packed.ref.startsWith('out:'));
  assert.equal(getStoredRef(packed.ref).blob.length, big.blob.length);
});

test('lote con hub falso: launch ×2 y resumen', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cm-'));
  let n = 0;
  const dispatch = createApiDispatcher({
    workspace: root,
    callHub: async (name) => {
      if (name === 'agent_session_create') {
        n += 1;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sessionId: `sess-${n}`,
              status: 'completed',
              summary: `resumen ${n}`,
              agentId: 'codex',
            }),
          }],
        };
      }
      return { content: [{ type: 'text', text: '{}' }] };
    },
    callBridgeTool: async () => 'ok',
    listSessions: async () => [],
  });
  const runner = new SandboxRunner({
    timeoutSeconds: 30,
    onApiCall: (path, args) => dispatch(path, args),
  });
  const value = await runner.run(`
    const launched = await silka.launch([
      { title: 'a', prompt: 'uno' },
      { title: 'b', prompt: 'dos' },
    ], { workspace: ${JSON.stringify(root)} });
    const list = Array.isArray(launched) ? launched : [launched];
    return list.map((s) => ({ id: s.sessionId, status: s.status, summary: s.summary }));
  `);
  assert.equal(value.length, 2);
  assert.equal(value[0].summary, 'resumen 1');
  assert.equal(value[1].summary, 'resumen 2');
});

test('NFR-TOK-01 aproximado ≥ 70% en lote simulado', () => {
  const metrics = measureNfrTok01();
  assert.ok(metrics.batchScenarioSavingsPercent >= 70, JSON.stringify(metrics));
});

test('merge.queue expone la cola (F4)', async () => {
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const queue = await dispatch(['merge', 'queue'], []);
  assert.ok(Array.isArray(queue));
});

function fakeHubWithLogs(sessions) {
  return async (name, args = {}) => {
    const id = args.sessionId;
    const session = sessions.get(id);
    if (name === 'agent_session_status' && session) {
      return { content: [{ type: 'text', text: JSON.stringify(session.card) }] };
    }
    if (name === 'agent_session_logs' && session) {
      return { content: [{ type: 'text', text: JSON.stringify({ events: session.events }) }] };
    }
    return { content: [{ type: 'text', text: '{}' }] };
  };
}

test('wait: primer turno con lastMessage desde eventos', async () => {
  const sessions = new Map([['s1', {
    card: { sessionId: 's1', status: 'completed', turnCount: 1 },
    events: [
      { type: 'status', content: '→ read a.mjs', metadata: { stream: 'stderr' } },
      { type: 'text', content: 'Listo: hay 3 archivos.', metadata: { type: 'result' } },
    ],
  }]]);
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: fakeHubWithLogs(sessions),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const card = await dispatch(['wait'], ['s1', { timeoutSeconds: 1 }]);
  assert.equal(card.turn, 1);
  assert.equal(card.lastMessage, 'Listo: hay 3 archivos.');
  assert.equal(card.noText, false);
});

test('wait: turno reanudado solo usa el mensaje del turno actual', async () => {
  const turn1 = { type: 'text', content: 'Respuesta del turno uno.', metadata: { type: 'result' } };
  const turn2 = [
    { type: 'status', content: '→ $ npm test', metadata: { stream: 'stderr' } },
    { type: 'text', content: 'Tests verdes.', metadata: { type: 'result' } },
  ];
  const sessions = new Map([['s2', {
    card: { sessionId: 's2', status: 'completed', turnCount: 2 },
    events: [turn1, ...turn2],
  }]]);
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: fakeHubWithLogs(sessions),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const card = await dispatch(['wait'], ['s2', { timeoutSeconds: 1 }]);
  assert.equal(card.turn, 2);
  assert.equal(card.lastMessage, 'Tests verdes.');
  assert.notEqual(card.lastMessage, 'Respuesta del turno uno.');
});

test('wait: turno sin texto expone noText', async () => {
  const sessions = new Map([['s3', {
    card: { sessionId: 's3', status: 'completed', turnCount: 1 },
    events: [{ type: 'status', content: '→ $ npm test', metadata: { stream: 'stderr' } }],
  }]]);
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: fakeHubWithLogs(sessions),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const card = await dispatch(['wait'], ['s3', { timeoutSeconds: 1 }]);
  assert.equal(card.lastMessage, '');
  assert.equal(card.noText, true);
});

test('lastMessage une deltas ✎ de Cursor fragmentados', () => {
  const events = [
    { type: 'status', content: '✎ Hola mun', metadata: { stream: 'stderr' } },
    { type: 'status', content: '✎ do desde', metadata: { stream: 'stderr' } },
    { type: 'status', content: '✎ Cursor.', metadata: { stream: 'stderr' } },
  ];
  const { lastMessage, noText } = lastAgentMessageFromEvents(events, 1);
  assert.equal(noText, false);
  assert.match(lastMessage.replace(/\s+/g, ' '), /Hola mundo desde Cursor/);
});

test('eventsForTurn corta tras el result del turno anterior', () => {
  const events = [
    { type: 'text', content: 'uno', metadata: { type: 'result' } },
    { type: 'text', content: 'dos', metadata: { type: 'result' } },
  ];
  assert.equal(eventsForTurn(events, 2).length, 1);
  assert.equal(eventsForTurn(events, 2)[0].content, 'dos');
});

test('agents.stats ya no está sin implementar', async () => {
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: async () => ({ content: [{ type: 'text', text: '[]' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const stats = await dispatch(['agents', 'stats'], ['codex', 'gpt']);
  assert.equal(typeof stats.samples, 'number');
});