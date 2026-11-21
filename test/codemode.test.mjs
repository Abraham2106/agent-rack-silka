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