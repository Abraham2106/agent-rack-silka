// BUG-09: la ficha nunca da "pass" con la sesión del agente caída o sin cambios.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDeliveryCard } from '../src/silka/tasks/card.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';

// El verify deja una marca: así se comprueba que no se corrió.
const VERIFY_MARK = 'node -e "require(\'fs\').writeFileSync(\'verify-corrio.txt\', \'1\')"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-se-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

/** Hub falso: la sesión escribe (o no) un archivo y termina con el estado indicado. */
function fakeHub({ writes = true, sessionId = 'sess-se' } = {}) {
  const sessions = new Map();
  const client = {
    async createSession(agent, prompt, workspace) {
      if (writes) fs.writeFileSync(path.join(workspace, 'entrega.txt'), 'ok');
      sessions.set(sessionId, { sessionId, status: 'running', workspace, agentId: agent });
      return { sessionId, status: 'running' };
    },
    async listSessions() { return [...sessions.values()]; },
    async getSessionStatus(id) { return sessions.get(id) || { sessionId: id, status: 'completed' }; },
    async sendInput() { return {}; },
    async close() {},
  };
  return { client, sessions, sessionId };
}

async function launchWith(hub, overrides = {}) {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo, { preferManual: false });
  const id = overrides.id || 'tk-se';
  await mgr.launch([{ id, title: 'tarea', scope: 'entrega.txt', deliver: 'archivo', verify: VERIFY_MARK, ...overrides }], {
    callHub: createHubCallAdapter(hub.client),
    manual: false,
  });
  return { repo, mgr, id };
}

const verifyRan = (task) => fs.existsSync(path.join(task.worktreePath, 'verify-corrio.txt'));

for (const outcome of ['failed', 'cancelled']) {
  test(`BUG-09: sesión terminada en ${outcome} → ficha fail, sin verify y sin reparación automática`, async () => {
    const hub = fakeHub();
    const { mgr, id } = await launchWith(hub);
    hub.sessions.get(hub.sessionId).status = outcome;
    await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
    const task = mgr.list().find((t) => t.id === id);
    assert.equal(task.sessionOutcome, outcome);
    assert.equal(task.card.gates, 'fail');
    assert.equal(task.card.risk, 'alto');
    const session = task.card.evidence.find((e) => e.kind === 'session');
    assert.equal(session.ok, false);
    assert.match(session.detail, new RegExp(outcome));
    assert.equal(task.card.evidence.some((e) => e.kind === 'verify'), false, 'el verify no se corre');
    assert.equal(verifyRan(task), false);
    assert.equal(task.state, STATES.VERIFICACION_FALLIDA);
  });
}

test('BUG-09: agent-rack dice completed pero el resultado del agente es un error → failed', async () => {
  // Visto con agent-rack real: un modelo inexistente da status "completed" y un evento result
  // con is_error: true ("Model unavailable").
  const hub = fakeHub({ writes: true });
  hub.client.getSessionLogTail = async () => ({
    events: [
      { type: 'status', content: '✗ Model unavailable: x' },
      { type: 'text', content: 'Model unavailable: x', metadata: { type: 'result', is_error: true, result: 'Model unavailable: x' } },
    ],
  });
  const { mgr, id } = await launchWith(hub);
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.sessionOutcome, 'failed');
  const session = task.card.evidence.find((e) => e.kind === 'session');
  assert.equal(session.ok, false);
  assert.match(session.detail, /Model unavailable/);
  assert.equal(task.card.gates, 'fail');
  assert.equal(verifyRan(task), false);
});

test('BUG-09: sesión que ya no está en el hub → desaparecida, ficha fail', async () => {
  const hub = fakeHub();
  const { mgr, id } = await launchWith(hub);
  hub.sessions.clear();
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.sessionOutcome, 'desaparecida');
  assert.equal(task.card.gates, 'fail');
  assert.equal(task.state, STATES.VERIFICACION_FALLIDA);
});

test('BUG-09: sesión completed sin cambios → ficha fail por diff y el verify no se corre', async () => {
  const hub = fakeHub({ writes: false });
  const { mgr, id } = await launchWith(hub, { maxRepairs: 0 });
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.card.gates, 'fail');
  const diff = task.card.evidence.find((e) => e.kind === 'diff');
  assert.equal(diff.ok, false);
  assert.match(diff.detail, /no cambió ningún archivo/);
  assert.equal(task.card.evidence.find((e) => e.kind === 'session').ok, true);
  assert.equal(verifyRan(task), false);
  assert.equal(task.state, STATES.VERIFICACION_FALLIDA);
});

test('BUG-09: sin cambios y con reparaciones disponibles → se le pide al agente que entregue', async () => {
  const hub = fakeHub({ writes: false });
  const { mgr, id } = await launchWith(hub, { maxRepairs: 1 });
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  // La reparación se despacha en el mismo ciclo: vuelve a trabajando sin outcome viejo.
  assert.equal(task.state, STATES.TRABAJANDO);
  assert.equal(task.sessionOutcome, undefined);
  assert.equal(task.repairCount, 1);
});

test('BUG-09: lo que el shim escribe en .silka/ del worktree no cuenta como entrega', async () => {
  // Hallado con agent-rack real: el shim del agente deja .silka/tasks.json en su cwd y, en un repo
  // que no ignora .silka/, la tarea vacía salía "pass" con un archivo cambiado.
  const hub = fakeHub({ writes: false });
  hub.client.createSession = async (agent, prompt, workspace) => {
    fs.mkdirSync(path.join(workspace, '.silka'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.silka', 'tasks.json'), '{"tasks":[]}');
    hub.sessions.set(hub.sessionId, { sessionId: hub.sessionId, status: 'running', workspace });
    return { sessionId: hub.sessionId, status: 'running' };
  };
  const { mgr, id } = await launchWith(hub, { maxRepairs: 0 });
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.deepEqual(task.card.filesAll, []);
  assert.equal(task.card.evidence.find((e) => e.kind === 'diff').ok, false);
  assert.equal(task.card.gates, 'fail');
});

test('BUG-09: allowEmptyDiff permite una tarea sin cambios', async () => {
  const hub = fakeHub({ writes: false });
  const { mgr, id } = await launchWith(hub, { allowEmptyDiff: true });
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.card.gates, 'pass');
  assert.equal(task.card.evidence.find((e) => e.kind === 'diff').ok, true);
  assert.equal(task.state, STATES.LISTA);
});

test('BUG-09: sesión completed con cambios → pass con evidencia de sesión, diff y verify', async () => {
  const hub = fakeHub();
  const { mgr, id } = await launchWith(hub);
  hub.sessions.get(hub.sessionId).status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [mgr.repoRoot] });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.card.gates, 'pass');
  assert.deepEqual(task.card.evidence.map((e) => e.kind).filter((k) => k !== 'setup'), ['session', 'diff', 'verify']);
  assert.equal(task.state, STATES.LISTA);
});

test('BUG-09: card.mjs — allOk exige que todos los ítems de evidencia estén ok', () => {
  const task = { id: 't', title: 't', scope: ['a'], version: 1 };
  const diff = { files: ['a/x.txt'], added: 1, removed: 0 };
  const pass = buildDeliveryCard(task, { diff, evidence: [{ kind: 'verify', ok: true }] });
  assert.equal(pass.gates, 'pass');
  for (const kind of ['session', 'diff', 'setup', 'otro']) {
    const card = buildDeliveryCard(task, { diff, evidence: [{ kind: 'verify', ok: true }, { kind, ok: false }] });
    assert.equal(card.gates, 'fail', `un ${kind} fallido reprueba`);
    assert.equal(card.verify.ok, false);
  }
});
