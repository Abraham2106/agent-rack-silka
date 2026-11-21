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
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { claimMergeLease } from '../src/silka/merge/owner.mjs';
import { mergeOneTask } from '../src/silka/merge/runner.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { getTask } from '../src/silka/tasks/store.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-me-auto-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'f.mjs'), 'export const x = 1;\n');
  gitRun(dir, ['add', 'f.mjs']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

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

test('FR-ME-01 cierra tarea y escribe metrics.jsonl sin estimar tokens', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([
    { id: 'me-close', title: 't', scope: 'f.mjs', deliver: 'cambio', verify: VERIFY_OK, agent: 'codex' },
  ]);
  await mgr.runAgentTurn('me-close', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'f.mjs'), 'export const x = 2;\n');
  });
  const rows = readMetrics(repo);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'me-close');
  assert.equal(rows[0].tokensIn, null);
  assert.equal(rows[0].sources.tokensIn, SIN_DATO);
  assert.equal(rows[0].verify, true);
  assert.equal(rows[0].sources.verify, 'task:card');
});

test('FR-ME-01 mezcla exitosa añade línea con mergeBroke false', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([
    { id: 'me-merge', title: 't', scope: 'f.mjs', deliver: 'cambio', verify: VERIFY_OK },
  ]);
  await mgr.runAgentTurn('me-merge', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'f.mjs'), 'export const x = 3;\n');
  });
  const task = getTask(repo, 'me-merge');
  assert.equal(task.state, STATES.LISTA);
  const svc = createReviewService(repo, { actor: 'human' });
  svc.approve('me-merge', { version: task.version });
  const token = claimMergeLease(repo).fencingToken;
  const result = await mergeOneTask(repo, 'me-merge', { fencingToken: token });
  assert.equal(result.merged, true);
  const rows = readMetrics(repo);
  assert.equal(rows.length, 2);
  const mergeRow = rows.find((r) => r.mergeBroke === false);
  assert.ok(mergeRow);
  assert.equal(mergeRow.sources.mergeBroke, 'cola_mezcla');
  assert.equal(mergeRow.sources.tokensIn, SIN_DATO);
});