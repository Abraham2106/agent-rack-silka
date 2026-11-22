// model-routing (openspec/changes/model-routing): tabla .silka/routing.json, resolución y registro.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Config aislada: el registro de modelos no disponibles vive aquí, nunca en ~/.config/silka.
process.env.SILKA_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-routing-config-'));

const { gitRun } = await import('../src/silka/tasks/git.mjs');
const { createTaskManager } = await import('../src/silka/tasks/manager.mjs');
const { buildDeliveryCard } = await import('../src/silka/tasks/card.mjs');
const { formatRoutingTable, loadRouting, resolveRouting } = await import('../src/silka/routing.mjs');
const { STATES } = await import('../src/silka/tasks/states.mjs');

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-routing-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

function writeRouting(repo, body) {
  fs.mkdirSync(path.join(repo, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.silka', 'routing.json'), typeof body === 'string' ? body : JSON.stringify(body));
}

function markUnavailable(agent, model) {
  const file = path.join(process.env.SILKA_CONFIG_DIR, 'models-unavailable.json');
  const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cur[agent] = { ...(cur[agent] || {}), [model]: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(cur));
}

function clearUnavailable() {
  fs.rmSync(path.join(process.env.SILKA_CONFIG_DIR, 'models-unavailable.json'), { force: true });
}

/** Arranca las tareas pendientes con un hub falso que anota cada payload de agent_session_create. */
async function startWithFakeHub(repo, specs, opts = {}) {
  const mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 10 });
  await mgr.launch(specs.map((s) => ({ scope: 'x', deliver: 'x', verify: 'node -e "0"', setup: 'node -e "0"', title: s.id, ...s })), { manual: false });
  const payloads = [];
  const logs = [];
  const callHub = async (name, args) => {
    if (name !== 'agent_session_create') return { content: [{ type: 'text', text: '{}' }] };
    payloads.push(args);
    return { content: [{ type: 'text', text: JSON.stringify({ sessionId: `s-${payloads.length}` }) }] };
  };
  await mgr.startPendingSessions({ callHub, log: (m) => logs.push(m), ...opts });
  return { mgr, payloads, logs };
}

const CHICA = { role: 'implementar', size: 'chica' };

test('MR-01: sin routing.json la tabla está vacía y el arranque usa el defecto (comportamiento actual)', async () => {
  const repo = initTempRepo();
  assert.deepEqual(loadRouting(repo).rules, {});
  const { mgr, payloads } = await startWithFakeHub(repo, [{ id: 'mr-01', ...CHICA }], { defaultAgent: 'codex', defaultModel: 'gpt-def' });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].agent, 'codex');
  assert.equal(payloads[0].model, 'gpt-def');
  const row = mgr.list().find((t) => t.id === 'mr-01');
  assert.equal(row.routing.rule, 'defecto');
  assert.equal(row.routing.agentRule, 'defecto');
});

test('MR-02: un rol desconocido falla la carga nombrando el rol, y la tarea no se lanza', async () => {
  const repo = initTempRepo();
  writeRouting(repo, { rules: { ejecutar: { chica: { models: ['x'] } } } });
  assert.throws(() => loadRouting(repo), (err) => /ejecutar/.test(err.message));
  const { mgr, payloads, logs } = await startWithFakeHub(repo, [{ id: 'mr-02', ...CHICA }]);
  assert.equal(payloads.length, 0, 'no se crea sesión con una tabla inválida');
  assert.match(logs.join('\n'), /ejecutar/);
  assert.match(mgr.list().find((t) => t.id === 'mr-02').startError || '', /ejecutar/);
});

test('MR-02: JSON mal formado y tamaño desconocido también fallan', () => {
  const repo = initTempRepo();
  writeRouting(repo, '{ no es json');
  assert.throws(() => loadRouting(repo), (err) => /no es JSON válido/.test(err.message));
  writeRouting(repo, { rules: { implementar: { enorme: { models: ['x'] } } } });
  assert.throws(() => loadRouting(repo), (err) => /enorme/.test(err.message));
});

test('MR-03: el modelo explícito de la tarea gana sobre la tabla', async () => {
  const repo = initTempRepo();
  writeRouting(repo, { rules: { implementar: { chica: { agent: 'cursor', models: ['tabla-y'] } } } });
  const { mgr, payloads } = await startWithFakeHub(repo, [{ id: 'mr-03', ...CHICA, model: 'explicito-x' }]);
  assert.equal(payloads[0].model, 'explicito-x');
  assert.equal(payloads[0].agent, 'cursor', 'el agente sin explícito sigue la tabla');
  const row = mgr.list().find((t) => t.id === 'mr-03');
  assert.equal(row.routing.rule, 'explícito');
});

test('MR-04: una tarea chica implementar sin modelo usa el que la tabla asigna', async () => {
  const repo = initTempRepo();
  writeRouting(repo, { rules: { implementar: { chica: { agent: 'codex', models: ['gpt-chica'] }, grande: { models: ['gpt-grande'] } } } });
  const { payloads } = await startWithFakeHub(repo, [{ id: 'mr-04', ...CHICA }], { defaultModel: 'gpt-def' });
  assert.equal(payloads[0].model, 'gpt-chica');
  assert.equal(payloads[0].agent, 'codex');
});

test('MR-05: la ficha muestra rol, agente, modelo y regla usados', async () => {
  const repo = initTempRepo();
  writeRouting(repo, { rules: { implementar: { chica: { agent: 'codex', models: ['gpt-chica'] } } } });
  const { mgr } = await startWithFakeHub(repo, [{ id: 'mr-05', ...CHICA }]);
  const row = mgr.list().find((t) => t.id === 'mr-05');
  assert.equal(row.state, STATES.TRABAJANDO);
  const card = buildDeliveryCard(row, { diff: { files: [], added: 0, removed: 0 }, evidence: [] });
  assert.deepEqual(
    { role: card.routing.role, agent: card.routing.agent, model: card.routing.model, rule: card.routing.rule },
    { role: 'implementar', agent: 'codex', model: 'gpt-chica', rule: 'tabla' },
  );
});

test('MR-06: si el primer modelo de la regla no está disponible, cae al siguiente y lo anota', async () => {
  const repo = initTempRepo();
  writeRouting(repo, { rules: { implementar: { chica: { agent: 'codex', models: ['gpt-caro', 'gpt-barato'] } } } });
  markUnavailable('codex', 'gpt-caro');
  try {
    const { mgr, payloads } = await startWithFakeHub(repo, [{ id: 'mr-06', ...CHICA }]);
    assert.equal(payloads[0].model, 'gpt-barato');
    const row = mgr.list().find((t) => t.id === 'mr-06');
    assert.equal(row.routing.fallback.from, 'gpt-caro');
    assert.equal(row.routing.fallback.to, 'gpt-barato');
  } finally {
    clearUnavailable();
  }
});

test('MR-06: si ningún modelo de la regla sirve, usa el defecto y lo avisa en la ficha', () => {
  const routing = parseTable({ rules: { implementar: { chica: { agent: 'codex', models: ['a', 'b'] } } } });
  markUnavailable('codex', 'a');
  markUnavailable('codex', 'b');
  try {
    const r = resolveRouting({ ...CHICA }, { routing, defaultAgent: 'codex', defaultModel: 'defecto-m' });
    assert.equal(r.model, 'defecto-m');
    assert.equal(r.rule, 'defecto');
    assert.match(r.fallback.reason, /ningún modelo/);
  } finally {
    clearUnavailable();
  }
});

test('silka routing show: la tabla efectiva lista los nueve pares y marca los que usan defecto', () => {
  const repo = initTempRepo();
  let text = formatRoutingTable(repo, { defaultAgent: 'codex', defaultModel: 'gpt-def' });
  assert.match(text, /sin .silka\/routing\.json/);
  assert.equal(text.split('\n').filter((l) => /^ {2}\w+\/\w+: /.test(l)).length, 9);
  assert.match(text, /implementar\/chica: defecto/);
  writeRouting(repo, { rules: { revisar: { grande: { agent: 'cursor', models: ['m1', 'm2'] } } } });
  text = formatRoutingTable(repo, { defaultAgent: 'codex' });
  assert.match(text, /revisar\/grande: agente=cursor modelos=m1 > m2/);
});

test('silka routing show imprime la tabla efectiva desde la CLI', async () => {
  const { spawnSync } = await import('node:child_process');
  const repo = initTempRepo();
  writeRouting(repo, { rules: { planificar: { grande: { agent: 'codex', models: ['m-plan'] } } } });
  const cli = fileURLToPath(new URL('../src/silka/cli.mjs', import.meta.url));
  const out = spawnSync(process.execPath, [cli, 'routing', 'show', '--workspace', repo], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /planificar\/grande: agente=codex modelos=m-plan/);
  assert.match(out.stdout, /implementar\/chica: defecto/);
});

function parseTable(raw) {
  const repo = initTempRepo();
  writeRouting(repo, raw);
  return loadRouting(repo);
}
