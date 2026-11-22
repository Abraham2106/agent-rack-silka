import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managerUsageFromClaudeJson } from '../scripts/benchmark/usage.mjs';
import { buildQualityRecord, outOfScopeCount, QUALITY_FIELDS } from '../scripts/benchmark/quality.mjs';
import { aggregatePath, buildReport, evaluate, writeReport } from '../scripts/benchmark/report.mjs';
import { loadTasks, runBenchmark, TASKS_FILE } from '../scripts/benchmark/run.mjs';

const CLAUDE_RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 1200,
    output_tokens: 300,
    cache_creation_input_tokens: 5000,
    cache_read_input_tokens: 20000,
  },
});

test('TB-02: uso real del manager sale del reporte del proveedor, con fuente explícita', () => {
  const u = managerUsageFromClaudeJson(CLAUDE_RESULT);
  assert.equal(u.tokensIn, 1200 + 5000 + 20000);
  assert.equal(u.tokensOut, 300);
  assert.equal(u.tokensCache, 20000);
  assert.equal(u.costUsd, 0.42);
  assert.equal(u.sources.tokensIn, 'claude-cli:usage');
});

test('TB-02: una corrida sin dato queda como "sin dato" y no inventa cifras', () => {
  for (const stdout of ['', 'no es json', '{"type":"result"}', '{"usage":{"input_tokens":"x"}}']) {
    const u = managerUsageFromClaudeJson(stdout);
    assert.equal(u.tokensIn, null, stdout);
    assert.equal(u.tokensOut, null, stdout);
    assert.equal(u.sources.tokensIn, 'sin dato', stdout);
    assert.equal(u.sources.costUsd, 'sin dato', stdout);
  }
});

test('TB-02: el uso también llega dentro de una lista de eventos (stream-json)', () => {
  const lines = JSON.stringify([{ type: 'assistant' }, JSON.parse(CLAUDE_RESULT)]);
  assert.equal(managerUsageFromClaudeJson(lines).tokensOut, 300);
});

test('TB-03: los dos caminos producen exactamente los mismos campos de calidad', () => {
  const solo = buildQualityRecord({ id: 'T1', agent: 'manager-solo', verify: 'pass', firstPass: true, mergeBroke: false, repairs: 0, outOfScope: 0 });
  const silka = buildQualityRecord({ id: 'T1', agent: 'manager-silka', verify: false, firstPass: false, mergeBroke: true, repairs: 2, outOfScope: 1 });
  assert.deepEqual(Object.keys(solo.quality), QUALITY_FIELDS);
  assert.deepEqual(Object.keys(silka.quality), QUALITY_FIELDS);
  assert.equal(solo.quality.verify, true);
  assert.equal(silka.quality.verify, false);
  assert.equal(silka.quality.mergeBroke, true);
});

test('TB-03: un dato de calidad que falta queda como sin dato, no como cero', () => {
  const r = buildQualityRecord({ id: 'T2', agent: 'manager-solo', verify: true });
  assert.equal(r.quality.repairs, null);
  assert.equal(r.quality.outOfScope, null);
  assert.equal(r.sources.repairs, 'sin dato');
});

test('archivos fuera de alcance se cuentan por prefijo de ruta', () => {
  const allowed = ['src/silka/codemode/', 'test/codemode.test.mjs'];
  const changed = ['src/silka/codemode/token-metrics.mjs', 'test/codemode.test.mjs', 'src/silka/hub.mjs', 'docs/x.md'];
  assert.equal(outOfScopeCount(changed, allowed), 2);
  assert.equal(outOfScopeCount(['src/silka/codemodeX/a.mjs'], allowed), 1);
});

// --- Informe sobre datos fijos (TB-02, TB-03, TB-04, TB-05) ---

const usage = (tokensIn, costUsd = 0.1) => ({
  tokensIn, tokensOut: 100, tokensCache: 0, costUsd,
  sources: { tokensIn: 'claude-cli:usage', tokensOut: 'claude-cli:usage', tokensCache: 'claude-cli:usage', costUsd: 'claude-cli:usage' },
});
const quality = (over = {}) => ({ verify: true, firstPass: true, repairs: 0, mergeBroke: false, outOfScope: 0, ...over });
const path3 = (tokensIn, q = quality()) => [1, 2, 3].map((i) => ({ taskId: `T${i}`, usage: usage(tokensIn), quality: q }));
const NO_DATA = { tokensIn: null, tokensOut: null, tokensCache: null, costUsd: null, sources: {} };

test('TB-04: 80% de ahorro con calidad igual cumple la meta', () => {
  const md = buildReport({ date: '2026-11-22', commit: 'abc', solo: path3(10000), silka: path3(2000) });
  assert.match(md, /80\.0%/);
  assert.match(md, /\*\*cumple\*\*/);
});

test('TB-04: 60% de ahorro no cumple la meta del 70%', () => {
  const md = buildReport({ date: '2026-11-22', commit: 'abc', solo: path3(10000), silka: path3(4000) });
  assert.match(md, /60\.0%/);
  assert.match(md, /\*\*no cumple\*\*/);
});

test('TB-03: más ahorro con más roturas al mezclar no se declara mejora neta', () => {
  const solo = path3(10000);
  const silka = path3(2000, quality({ mergeBroke: true }));
  const e = evaluate(aggregatePath(solo), aggregatePath(silka));
  assert.equal(e.verdict, 'no cumple');
  const md = buildReport({ date: '2026-11-22', commit: 'abc', solo, silka });
  assert.match(md, /Ahorro con peor calidad: no es mejora neta/);
  assert.match(md, /Roturas al mezclar \| 0 \| 3/);
});

test('TB-02: si un camino no reporta uso, el informe dice "sin dato" y no calcula ahorro', () => {
  const silka = [1, 2, 3].map((i) => ({ taskId: `T${i}`, usage: NO_DATA, quality: quality() }));
  const md = buildReport({ date: '2026-11-22', commit: 'abc', solo: path3(10000), silka });
  assert.match(md, /Ahorro de tokens de entrada: sin dato \(no se calcula\)/);
  assert.match(md, /\*\*sin dato\*\*/);
  assert.doesNotMatch(md, /Ahorro de tokens de entrada: \d/);
});

test('TB-05: el informe se guarda en docs/benchmarks con commit, modelos y tabla', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-report-'));
  const md = buildReport({
    date: '2026-11-22', commit: 'deadbeef', tasksHash: 'h1', models: { solo: 'm-a', silka: 'm-b' },
    solo: path3(10000), silka: path3(2000),
  });
  const file = writeReport(dir, '2026-11-22', md);
  assert.equal(path.basename(file), '2026-11-22.md');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /deadbeef/);
  assert.match(text, /m-a/);
  assert.match(text, /\| Tokens de entrada del manager \|/);
  assert.match(text, /## Límites de la medición/);
});

// --- Orquestación con runners falsos (TB-01) ---

test('TB-01: ambos caminos corren las mismas tareas desde el mismo commit', async () => {
  const { tasks, hash } = loadTasks(TASKS_FILE);
  assert.ok(tasks.length >= 3);
  const seen = [];
  const fakeRunner = (pathName) => async (task, { commit }) => {
    seen.push({ path: pathName, task: task.id, commit });
    return {
      stdout: JSON.stringify({ usage: { input_tokens: pathName === 'solo' ? 9000 : 3000, output_tokens: 10 } }),
      verify: true, firstPass: true, mergeBroke: false, repairs: 0,
      changedFiles: [task.permitidos[0]],
    };
  };
  const workdirFor = async () => ({ dir: os.tmpdir(), cleanup: async () => {} });
  const r = await runBenchmark({
    commit: 'c0ffee', tasks, tasksHash: hash,
    runners: { solo: fakeRunner('solo'), silka: fakeRunner('silka') },
    workdirFor, models: { solo: 'm-a', silka: 'm-b' }, now: new Date('2026-11-22T12:00:00Z'),
  });
  assert.equal(seen.length, tasks.length * 2);
  assert.ok(seen.every((s) => s.commit === 'c0ffee'));
  assert.equal(r.solo.length, tasks.length);
  assert.equal(r.silka.length, tasks.length);
  assert.match(r.markdown, /c0ffee/);
  assert.match(r.markdown, /Ahorro de tokens de entrada: 66\.7%/);
  assert.equal(r.date, '2026-11-22');
});

test('loadTasks exige al menos 3 tareas con verify y permitidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tasks-'));
  const bad = path.join(dir, 'tasks.json');
  fs.writeFileSync(bad, JSON.stringify({ tasks: [{ id: 'T1', verify: 'x', permitidos: [] }] }));
  assert.throws(() => loadTasks(bad), /N >= 3/);
});

test('el comando documentado arranca y muestra el uso', () => {
  const script = fileURLToPath(new URL('../scripts/benchmark/run.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Uso: node scripts\/benchmark\/run\.mjs/);
});
