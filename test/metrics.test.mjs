import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendMetric, buildTaskMetric, metricsFile } from '../src/silka/metrics/record.mjs';
import { readMetrics } from '../src/silka/metrics/read.mjs';
import { aggregateAgentStats } from '../src/silka/metrics/stats.mjs';
import { estimateTokensFromText, tokensFromAgentReport } from '../src/silka/metrics/tokens.mjs';
import { baselineComparisonTable } from '../src/silka/metrics/baseline.mjs';
import { createApiDispatcher } from '../src/silka/codemode/api-dispatch.mjs';
import { SIN_DATO } from '../src/silka/metrics/fields.mjs';

test('T-ME-01 registra fuente y sin dato en null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-me-'));
  for (const agent of ['codex', 'cursor', 'opencode']) {
    const row = appendMetric(root, {
      id: `t-${agent}`,
      agent,
      model: null,
      turns: null,
    });
    assert.equal(row.sources.tokensIn, SIN_DATO);
    assert.equal(row.tokensIn, null);
  }
  const file = metricsFile(root);
  assert.ok(fs.existsSync(file));
  assert.equal(readMetrics(root).length, 3);
});

test('tokens reales vs estimación marcada', () => {
  const fromCodex = tokensFromAgentReport('codex', { usage: { input_tokens: 42, output_tokens: 7 } });
  assert.equal(fromCodex.tokensIn, 42);
  assert.match(fromCodex.sources.tokensIn, /codex/);
  const est = estimateTokensFromText('abcd');
  assert.equal(est.tokensIn, 1);
  assert.equal(est.sources.tokensIn, 'estimacion:chars/4');
});

test('T-ME-02 baseline tabla comparable para 5 PRs', () => {
  const cases = Array.from({ length: 5 }, (_, i) => ({
    id: `pr-${i + 1}`,
    legacyTokens: 90_000,
    contextTokens: 30_000,
    verifyBaseline: 0.88,
    verifyWithContext: 0.9,
  }));
  const table = baselineComparisonTable(cases);
  assert.equal(table.rows.length, 5);
  assert.ok(table.rows.every((r) => r.tokenDelta > 0));
  assert.ok(table.nfrTok01.meetsNfrTok01Batch);
});

test('agents.stats vía Code Mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-me-stats-'));
  appendMetric(root, {
    id: 'a1',
    agent: 'codex',
    model: 'm1',
    tokensIn: 100,
    durationMs: 5000,
    firstPass: true,
    verify: true,
    sources: { tokensIn: 'codex:turn.completed', durationMs: 'silka:timer' },
  });
  const dispatch = createApiDispatcher({
    workspace: root,
    callHub: async () => ({ content: [{ type: 'text', text: '[]' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const stats = await dispatch(['agents', 'stats'], ['codex', 'm1']);
  assert.equal(stats.samples, 1);
  assert.equal(stats.medianTokensIn, 100);
});

test('buildTaskMetric conserva campos', () => {
  const row = buildTaskMetric({ id: 'x', agent: 'codex', verify: 'fail', sources: { verify: 'task:verify' } });
  assert.equal(row.verify, 'fail');
  assert.equal(row.sources.verify, 'task:verify');
});