import assert from 'node:assert/strict';
import test from 'node:test';
import { opencodeUsageFromJsonl } from '../scripts/benchmark/usage.mjs';
import { countSilkaCalls, opencodeSilkaHint, silkaCallsLimit } from '../scripts/benchmark/run.mjs';
import { SIN_DATO } from '../src/silka/metrics/fields.mjs';

// Línea real de `opencode run --format json` (corrida mínima con opencode/hy4-flash-free).
const STEP_FINISH_REAL = JSON.stringify({
  type: 'step_finish',
  timestamp: 1795387970412,
  sessionID: 'ses_test',
  part: {
    id: 'prt_1',
    type: 'step-finish',
    reason: 'stop',
    cost: 0,
    tokens: { input: 15360, output: 3, reasoning: 13, cache: { read: 1792, write: 0 } },
  },
});

function stepWith(tokens, cost = 0) {
  return JSON.stringify({ type: 'step_finish', part: { id: 'p', type: 'step-finish', cost, tokens } });
}

test('OpenCode: el uso sale de step_finish y se suma por pasos', () => {
  const stdout = [
    '{"type":"step_start","part":{}}',
    stepWith({ input: 100, output: 10, reasoning: 2, cache: { read: 50, write: 5 } }, 0.001),
    stepWith({ input: 200, output: 20, reasoning: 3, cache: { read: 60, write: 0 } }, 0.002),
  ].join('\n');
  const u = opencodeUsageFromJsonl(stdout);
  assert.equal(u.tokensIn, 100 + 5 + 50 + 200 + 0 + 60);
  assert.equal(u.tokensOut, 10 + 2 + 20 + 3);
  assert.equal(u.tokensCache, 110);
  assert.ok(Math.abs(u.costUsd - 0.003) < 1e-12);
  assert.equal(u.sources.tokensIn, 'opencode:step_finish.tokens');
});

test('OpenCode: la línea real de una corrida mínima se lee tal cual', () => {
  const u = opencodeUsageFromJsonl(STEP_FINISH_REAL);
  assert.equal(u.tokensIn, 15360 + 0 + 1792);
  assert.equal(u.tokensOut, 3 + 13);
  assert.equal(u.tokensCache, 1792);
  assert.equal(u.costUsd, 0);
  assert.equal(u.sources.costUsd, 'opencode:step_finish.tokens');
});

test('OpenCode: sin ningún step_finish con uso el dato queda sin dato, nunca estimado', () => {
  for (const stdout of ['', 'no es json', '{"type":"text","part":{"text":"ok"}}']) {
    const u = opencodeUsageFromJsonl(stdout);
    assert.equal(u.tokensIn, null);
    assert.equal(u.tokensOut, null);
    assert.equal(u.tokensCache, null);
    assert.equal(u.costUsd, null);
    assert.equal(u.sources.tokensIn, SIN_DATO);
    assert.equal(u.sources.costUsd, SIN_DATO);
  }
});

test('OpenCode: si falta un campo de uso en un paso, el total queda sin dato', () => {
  const stdout = [stepWith({ input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }), stepWith({ input: 5, output: 1 })].join('\n');
  const u = opencodeUsageFromJsonl(stdout);
  assert.equal(u.tokensIn, null);
  assert.equal(u.tokensOut, null);
  assert.equal(u.sources.tokensIn, SIN_DATO);
});

test('OpenCode: el costo ausente queda sin dato aunque el uso exista', () => {
  const noCost = JSON.stringify({
    type: 'step_finish',
    part: { id: 'p', tokens: { input: 7, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } },
  });
  const u = opencodeUsageFromJsonl(noCost);
  assert.equal(u.tokensIn, 7);
  assert.equal(u.costUsd, null);
  assert.equal(u.sources.costUsd, SIN_DATO);
});

test('Silka en OpenCode: cuenta llamadas distintas a silka_execute', () => {
  const call = (id, tool) => JSON.stringify({ type: 'tool_use', part: { id, tool, state: { status: 'completed' } } });
  const stdout = [call('a', 'agent-rack_silka_execute'), call('a', 'agent-rack_silka_execute'), call('b', 'read'), call('c', 'agent-rack_silka_execute')].join('\n');
  assert.equal(countSilkaCalls(stdout), 2);
  assert.equal(countSilkaCalls(call('x', 'read')), 0);
  assert.equal(countSilkaCalls(''), 0);
});

test('Silka en OpenCode: una corrida sin silka_execute se declara en el informe', () => {
  assert.deepEqual(silkaCallsLimit([{ silkaCalls: 1 }, { silkaCalls: 1 }]), []);
  const lim = silkaCallsLimit([{ silkaCalls: 0 }, { silkaCalls: 1 }, { silkaCalls: 0 }]);
  assert.equal(lim.length, 1);
  assert.match(lim[0], /2 de 3 tareas/);
  assert.deepEqual(silkaCallsLimit([{ silkaCalls: null }]), []);
});

test('Silka en OpenCode: la instrucción fija el agente, el modelo y el workspace', () => {
  const hint = opencodeSilkaHint('C:\\tmp\\wt', 'opencode/hy4-flash-free');
  assert.match(hint, /silka_execute/);
  assert.match(hint, /agent: 'opencode'/);
  assert.match(hint, /model: 'opencode\/hy4-flash-free'/);
  assert.match(hint, /workspace: 'C:\\tmp\\wt'/);
});
