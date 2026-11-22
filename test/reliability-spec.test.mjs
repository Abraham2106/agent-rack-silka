// Escenarios de openspec/specs/reliability/spec.md que faltaban en reliability.test.mjs:
// FR-RL-03 (symlink fuera del worktree) y FR-RL-04 (reinicio del hub y máximo de reparaciones).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { listInbox } from '../src/silka/review/inbox.mjs';
import { runAcceptCriteria } from '../src/silka/tasks/accept.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

const VERIFY_FAIL = 'node -e "process.exit(1)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rspec-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

function taskWithVerifyFail(overrides = {}) {
  return {
    title: 'tarea de reliability',
    scope: 'src/',
    deliver: 'cambio',
    verify: VERIFY_FAIL,
    ...overrides,
  };
}

/** Cliente de hub simulado: guarda cada send para comprobar duplicados. */
function fakeHub(sessionId) {
  const sent = [];
  const sessions = new Map([[sessionId, { sessionId, status: 'running' }]]);
  const client = {
    async createSession() {
      sessions.set(sessionId, { sessionId, status: 'running' });
      return { sessionId, status: 'running' };
    },
    async listSessions() {
      return [...sessions.values()];
    },
    async getSessionStatus(id) {
      return sessions.get(id) || { sessionId: id, status: 'completed' };
    },
    async sendInput(id, message) {
      sent.push({ sessionId: id, message });
    },
    async close() {},
  };
  return { client, sent };
}

test('FR-RL-03: criterio file y grep rechazan de forma segura un path que sale del worktree por symlink', async (t) => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rspec-wt-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rspec-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP_SECRET_OUTSIDE\n');
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  const fileLink = path.join(worktree, 'src', 'escape-file.txt');
  const dirLink = path.join(worktree, 'src', 'escape-dir');
  let relPath;
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), fileLink, 'file');
    relPath = 'src/escape-file.txt';
  } catch {
    try {
      fs.symlinkSync(outside, dirLink, 'junction');
      relPath = 'src/escape-dir/secret.txt';
    } catch {
      t.skip('Este entorno no permite crear symlinks ni junctions.');
      return;
    }
  }
  // Ningún tipo de criterio acepta leer fuera del worktree, aunque el path declarado parezca interno.
  for (const criterion of [
    { file: { path: relPath, exists: true } },
    { grep: { pattern: 'TOP_SECRET_OUTSIDE', path: relPath } },
  ]) {
    assert.throws(
      () => runAcceptCriteria(worktree, 'tk-escape', worktree, [criterion]),
      (err) => isSilkaError(err)
        && err.code === 'E_POLICY'
        && /Ruta fuera del worktree/.test(err.message),
    );
  }
});

test('FR-RL-04: reinicio del hub a mitad de reparación no duplica el send', async () => {
  const repo = initTempRepo();
  const { client, sent } = fakeHub('sess-rspec-restart');
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch(
    [taskWithVerifyFail({ id: 'tk-rspec-restart', maxRepairs: 1 })],
    { callHub: createHubCallAdapter(client), manual: false },
  );
  const launched = mgr.list().find((t) => t.id === 'tk-rspec-restart');
  assert.equal(launched.state, STATES.TRABAJANDO);
  assert.equal(launched.sessionId, 'sess-rspec-restart');

  await mgr.runAgentTurn('tk-rspec-restart', async (cwd) => { fs.writeFileSync(path.join(cwd, 'cambio.txt'), 'x'); });
  let row = mgr.list().find((t) => t.id === 'tk-rspec-restart');
  assert.equal(row.state, STATES.REPARANDO);
  assert.ok(row.pendingRepair?.message);
  assert.equal(row.repairCount || 0, 0);

  // El hub se reinicia: la reparación sigue en disco, pero el manager y el adapter son nuevos.
  const afterRestart = createTaskManager(repo);
  const first = await afterRestart.dispatchPendingRepairs({ callHub: createHubCallAdapter(client) });
  assert.equal(first, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionId, 'sess-rspec-restart');
  assert.match(sent[0].message, /La verificación de Silka falló/);
  assert.match(sent[0].message, /Código de salida: 1/);
  row = afterRestart.list().find((t) => t.id === 'tk-rspec-restart');
  assert.equal(row.state, STATES.TRABAJANDO);
  assert.equal(row.repairCount, 1);
  assert.equal(row.pendingRepair, undefined);

  // Otro reinicio antes de que el agente entregue: no se reenvía la misma reparación.
  const afterSecondRestart = createTaskManager(repo);
  const second = await afterSecondRestart.dispatchPendingRepairs({ callHub: createHubCallAdapter(client) });
  assert.equal(second, 0);
  assert.equal(sent.length, 1);
});

test('FR-RL-04: agotar el máximo de reparaciones deja la tarea en verificación fallida en bandeja', async () => {
  const repo = initTempRepo();
  const { client, sent } = fakeHub('sess-rspec-max');
  const callHub = createHubCallAdapter(client);
  const mgr = createTaskManager(repo, { preferManual: false });
  // Sin maxRepairs explícito: el default es 2 (FR-RL-04).
  await mgr.launch([taskWithVerifyFail({ id: 'tk-rspec-max' })], { callHub, manual: false });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await mgr.runAgentTurn('tk-rspec-max', async () => {});
    let row = mgr.list().find((t) => t.id === 'tk-rspec-max');
    assert.equal(row.state, STATES.REPARANDO);
    assert.equal(row.pendingRepair?.id, `tk-rspec-max-repair-${attempt}`);
    assert.equal(await mgr.dispatchPendingRepairs({ callHub }), 1);
    row = mgr.list().find((t) => t.id === 'tk-rspec-max');
    assert.equal(row.state, STATES.TRABAJANDO);
    assert.equal(row.repairCount, attempt);
  }
  assert.equal(sent.length, 2);

  // Tercer fallo: ya no cabe otra reparación.
  await mgr.runAgentTurn('tk-rspec-max', async () => {});
  const failed = mgr.list().find((t) => t.id === 'tk-rspec-max');
  assert.equal(failed.state, STATES.VERIFICACION_FALLIDA);
  assert.equal(failed.repairCount, 2);
  assert.equal(failed.pendingRepair, undefined);
  assert.equal(mgr.card('tk-rspec-max').gates, 'fail');
  assert.equal(await mgr.dispatchPendingRepairs({ callHub }), 0);
  assert.equal(sent.length, 2);
  assert.ok(listInbox(repo).some((i) => i.id === 'tk-rspec-max' && i.state === STATES.VERIFICACION_FALLIDA));
});
