import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { listInbox } from '../src/silka/review/inbox.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { mutateTaskStore } from '../src/silka/tasks/store.mjs';
import { runVerifyCommands } from '../src/silka/tasks/verify.mjs';
import { runAcceptCriteria } from '../src/silka/tasks/accept.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';
const VERIFY_FAIL = 'node -e "process.exit(1)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rel-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

function baseTask(overrides = {}) {
  return {
    title: 'tarea',
    scope: 'src/',
    deliver: 'cambio',
    verify: VERIFY_OK,
    ...overrides,
  };
}

test('agente dice OK pero verify falla: no lista_para_revision', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-lie', verify: VERIFY_FAIL })]);
  await mgr.runAgentTurn('tk-lie', async (cwd) => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'x.txt'), 'x');
  }, { agentNotes: 'tests OK, todo listo' });
  const task = mgr.list().find((t) => t.id === 'tk-lie');
  assert.notEqual(task.state, STATES.LISTA);
  const card = mgr.card('tk-lie');
  assert.equal(card.gates, 'fail');
  assert.match(card.agentSays, /tests OK/);
  assert.ok(card.evidence.some((e) => e.kind === 'verify' && !e.ok));
});

test('verify inferido desde package.json', async () => {
  const repo = initTempRepo();
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }));
  const mgr = createTaskManager(repo);
  await mgr.launch([{
    id: 'tk-inf',
    title: 'inf',
    scope: 'src/',
    deliver: 'x',
  }]);
  const task = mgr.list().find((t) => t.id === 'tk-inf');
  assert.equal(task.verifySource, 'inferido');
  assert.match(task.verify[0], /npm run test/);
});

test('accept grep y file en evidence', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({
    id: 'tk-acc',
    accept: [
      { file: { path: 'src/must.txt', exists: true } },
      { grep: { pattern: 'HELLO', path: 'src/must.txt' } },
    ],
  })]);
  await mgr.runAgentTurn('tk-acc', async (cwd) => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'must.txt'), 'HELLO\n');
  });
  const card = mgr.card('tk-acc');
  assert.equal(card.gates, 'pass');
  assert.equal(card.evidence.filter((e) => e.kind === 'accept').length, 2);
});

test('reparación acotada y verificacion_fallida en bandeja', async () => {
  const repo = initTempRepo();
  const sent = [];
  const sessions = new Map([['sess-r', { sessionId: 'sess-r', status: 'completed', workspace: repo }]]);
  const client = {
    async createSession(agent, prompt, workspace) {
      const sessionId = 'sess-r';
      sessions.set(sessionId, { sessionId, status: 'running', workspace, agentId: agent });
      return { sessionId, status: 'running', agentId: agent };
    },
    async listSessions() {
      return [...sessions.values()];
    },
    async getSessionStatus(id) {
      return sessions.get(id) || { sessionId: id, status: 'completed' };
    },
    async sendInput(id, message) {
      sent.push(message);
      return {};
    },
    async close() {},
  };
  const callHub = createHubCallAdapter(client);
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([baseTask({ id: 'tk-rep', verify: VERIFY_FAIL, maxRepairs: 1 })], { callHub, manual: false });
  const live = mgr.list().find((t) => t.id === 'tk-rep');
  sessions.get('sess-r').status = 'completed';
  await superviseTasksOnce(client, { repoRoots: [repo] });
  assert.equal(sent.length, 1);
  assert.equal(mgr.list().find((t) => t.id === 'tk-rep').state, STATES.TRABAJANDO);
  await mgr.runAgentTurn('tk-rep', async () => {});
  const failed = mgr.list().find((t) => t.id === 'tk-rep');
  assert.equal(failed.state, STATES.VERIFICACION_FALLIDA);
  const inbox = listInbox(repo);
  assert.ok(inbox.some((i) => i.id === 'tk-rep' && i.state === STATES.VERIFICACION_FALLIDA));
});

test('reinicio hub: un solo send de reparación', async () => {
  const repo = initTempRepo();
  const sent = [];
  const client = {
    async listSessions() {
      return [{ sessionId: 'sess-idem', status: 'completed' }];
    },
    async getSessionStatus(id) {
      return { sessionId: id, status: 'completed' };
    },
    async sendInput(id, message) {
      sent.push(message);
    },
    async close() {},
  };
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-idem', verify: VERIFY_FAIL })]);
  await mgr.runAgentTurn('tk-idem', async () => {});
  mutateTaskStore(repo, (store) => {
    const row = store.tasks.find((t) => t.id === 'tk-idem');
    row.sessionId = 'sess-idem';
    row.pendingRepair = { id: 'tk-idem-repair-1', message: 'falló verify' };
    row.state = STATES.REPARANDO;
    return store;
  });
  const callHub = createHubCallAdapter(client);
  const n1 = await mgr.dispatchPendingRepairs({ callHub });
  const n2 = await mgr.dispatchPendingRepairs({ callHub });
  assert.equal(n1, 1);
  assert.equal(n2, 0);
  assert.equal(sent.length, 1);
});

test('E_TASK_INVALID sin verify inferible', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await assert.rejects(
    () => mgr.launch([{ title: 'x', scope: 'a/', deliver: 'y' }]),
    (err) => isSilkaError(err) && err.code === 'E_TASK_INVALID',
  );
});

test('allowNoVerify fuerza riesgo alto', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([{
    id: 'tk-nov',
    title: 'nov',
    scope: 'src/',
    deliver: 'x',
    allowNoVerify: true,
  }]);
  await mgr.runAgentTurn('tk-nov', async (cwd) => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'a.txt'), 'a');
  });
  const card = mgr.card('tk-nov');
  assert.equal(card.gates, 'pass');
  assert.equal(card.risk, 'alto');
  assert.ok(card.riskDetail.requiresHuman);
});

test('verify: comando con comillas y exit 1 = fallido', () => {
  const r = runVerifyCommands(process.cwd(), [VERIFY_FAIL]);
  assert.equal(r.ok, false);
  assert.match(r.log, /exit: 1/);
});

test('accept grep rechaza symlink fuera del worktree', async (t) => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-wt-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET_OUT');
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  const fileLink = path.join(worktree, 'src', 'via-link.txt');
  const dirLink = path.join(worktree, 'src', 'via-junction');
  let relPath = null;
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), fileLink, 'file');
    relPath = 'src/via-link.txt';
  } catch {
    try {
      fs.symlinkSync(outside, dirLink, 'junction');
      relPath = 'src/via-junction/secret.txt';
    } catch {
      t.skip('No se pudo crear symlink ni junction en este entorno');
      return;
    }
  }
  assert.throws(
    () => runAcceptCriteria(worktree, 'tk-sym', worktree, [{ grep: { pattern: 'SECRET', path: relPath } }]),
    (err) => isSilkaError(err) && err.code === 'E_POLICY',
  );
});