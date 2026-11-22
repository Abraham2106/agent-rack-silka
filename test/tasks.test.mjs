import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiDispatcher } from '../src/silka/codemode/api-dispatch.mjs';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { silkaConfigDir } from '../src/silka/paths.mjs';
import { gitRun, emptyHooksDir } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';
import { worktreePath } from '../src/silka/tasks/worktree.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { readTaskLogRef } from '../src/silka/tasks/log-store.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-tk-'));
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

test('T-TK-01 tres tareas paralelas: fichas solo con sus archivos', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 5 });
  const specs = [
    baseTask({ id: 'tk-a1', title: 'a', scope: 'src/a/' }),
    baseTask({ id: 'tk-b1', title: 'b', scope: 'src/b/' }),
    baseTask({ id: 'tk-c1', title: 'c', scope: 'src/c/' }),
  ];
  await mgr.launch(specs);
  for (const spec of specs) {
    await mgr.runAgentTurn(spec.id, async (cwd) => {
      const file = path.join(cwd, 'src', spec.title, 'f.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, spec.title);
    });
  }
  const cards = specs.map((s) => mgr.card(s.id));
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.ok(card.files.every((f) => f.includes(`src/${card.title}/`)));
    assert.equal(card.files.length, 1);
  }
});

test('T-TK-02 dependsOn: espera mezcla de dependencia', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([
    baseTask({ id: 'tk-dep', title: 'dep', scope: 'src/dep/' }),
    baseTask({ id: 'tk-child', title: 'child', scope: 'src/child/', dependsOn: ['tk-dep'] }),
  ]);
  const childBefore = mgr.list().find((t) => t.id === 'tk-child');
  assert.equal(childBefore.state, STATES.ESPERANDO_DEPS);
  await mgr.runAgentTurn('tk-dep', async (cwd) => {
    fs.mkdirSync(path.join(cwd, 'src', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'dep', 'x.txt'), 'x');
  });
  mgr.markMerged('tk-dep');
  mgr.schedule();
  const childAfter = mgr.list().find((t) => t.id === 'tk-child');
  assert.equal(childAfter.state, STATES.TRABAJANDO);
});

test('T-TK-03 .github/workflows marca riesgo alto', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-ci', scope: '.github/workflows/' })]);
  await mgr.runAgentTurn('tk-ci', async (cwd) => {
    const file = path.join(cwd, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: ci\n');
  });
  const card = mgr.card('tk-ci');
  assert.equal(card.risk, 'alto');
  assert.ok(card.riskDetail.sensitiveFiles.some((f) => f.includes('.github/workflows')));
});

test('T-TK-04 SEC-06: hook escrito por agente no lo ejecuta el hub', () => {
  const repo = initTempRepo();
  const hooks = path.join(repo, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const hook = path.join(hooks, 'pre-commit');
  fs.writeFileSync(hook, process.platform === 'win32'
    ? '@echo HOOK_RAN_SILKA& exit /b 1'
    : '#!/bin/sh\necho HOOK_RAN_SILKA\nexit 1');
  if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);
  const poison = path.join(silkaConfigDir(), 'git-empty-hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(poison), { recursive: true });
  fs.writeFileSync(poison, '#!/bin/sh\nexit 1\n');
  emptyHooksDir();
  assert.ok(!fs.existsSync(poison));
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'x\n');
  gitRun(repo, ['add', 'tracked.txt']);
  const commit = gitRun(repo, ['commit', '-m', 'sin-hook']);
  assert.equal(commit.ok, true, commit.stderr);
  assert.ok(!commit.stdout.includes('HOOK_RAN_SILKA'));
  assert.ok(!commit.stderr.includes('HOOK_RAN_SILKA'));
});

test('T-TK-05 sesión viva: no borrar worktree al pedir descartar', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-live' })]);
  mgr.setSessionAlive('tk-live', true);
  const res = mgr.requestDiscard('tk-live');
  assert.equal(res.deferred, true);
  assert.ok(fs.existsSync(worktreePath(repo, 'tk-live')));
  mgr.setSessionAlive('tk-live', false);
  mgr.finalizePendingDiscard('tk-live');
  assert.ok(!fs.existsSync(worktreePath(repo, 'tk-live')));
});

test('SEC-07 verify ignora comandos sugeridos por el agente', async () => {
  const repo = initTempRepo();
  const evil = 'node -e "require(\\"fs\\").writeFileSync(\\"pwned.txt\\",\\"1\\")"';
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-sec7', verify: VERIFY_OK })]);
  await mgr.runAgentTurn('tk-sec7', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'agent-output.txt'), `verify sugerido: ${evil}`);
  }, { agentNotes: `Ejecuta ${evil}` });
  const log = readTaskLogRef(mgr.card('tk-sec7').verify.ref, repo);
  assert.match(log, /node -e "process\.exit\(0\)"/);
  assert.ok(!log.includes('pwned.txt'));
  assert.ok(!fs.existsSync(path.join(repo, 'pwned.txt')));
});

test('E2E hub falso: launch, supervisor, ficha', async () => {
  const repo = initTempRepo();
  let status = 'running';
  const sessions = new Map();
  const client = {
    async createSession(agent, prompt, workspace) {
      const sessionId = 'sess-e2e';
      fs.mkdirSync(path.join(workspace, 'src', 'hub'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'src', 'hub', 'out.txt'), 'ok');
      sessions.set(sessionId, { sessionId, status, workspace, agentId: agent });
      return { sessionId, status: 'running', agentId: agent };
    },
    async listSessions() {
      return [...sessions.values()].map((s) => ({ ...s, status }));
    },
    async getSessionStatus(id) {
      const s = sessions.get(id);
      return s ? { ...s, status } : { sessionId: id, status: 'completed' };
    },
    async close() {},
  };
  const mgr = createTaskManager(repo, { preferManual: false });
  const callHub = createHubCallAdapter(client);
  await mgr.launch([baseTask({ id: 'tk-e2e', scope: 'src/hub/', title: 'hub' })], { callHub, manual: false });
  const live = mgr.list().find((t) => t.id === 'tk-e2e');
  assert.equal(live.sessionId, 'sess-e2e');
  assert.equal(live.state, STATES.TRABAJANDO);
  status = 'completed';
  await superviseTasksOnce(client, { repoRoots: [repo] });
  const card = mgr.card('tk-e2e');
  assert.equal(card.gates, 'pass');
  assert.equal(card.files.length, 1);
  assert.ok(card.files[0].includes('src/hub/out.txt'));
});

test('transiciones inválidas rechazadas', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-tr' })]);
  assert.throws(
    () => mgr.transition('tk-tr', STATES.MEZCLADA, 'ilegal'),
    (err) => isSilkaError(err) && err.code === 'E_POLICY',
  );
});

test('verify log por referencia y Code Mode card/plan', async () => {
  const repo = initTempRepo();
  const planPath = path.join(repo, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify([baseTask({ id: 'tk-api', title: 'api' })]));
  const dispatch = createApiDispatcher({
    workspace: repo,
    callHub: async (name) => {
      if (name === 'agent_session_create') {
        return { content: [{ type: 'text', text: JSON.stringify({ sessionId: 'sess-api', status: 'running' }) }] };
      }
      return { content: [{ type: 'text', text: '{}' }] };
    },
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const plan = await dispatch(['plan', 'fromFile'], [planPath]);
  assert.equal(plan.length, 1);
  const launched = await dispatch(['launch'], [plan, { isolate: 'worktree', workspace: repo }]);
  const id = launched[0].id;
  // BUG-05: el launch del bridge no arranca la sesión; queda planificada con su worktree y la
  // arranca el supervisor del hub (aquí, a mano con el mismo callHub falso).
  assert.equal(launched[0].state, STATES.PLANIFICADA);
  assert.equal(launched[0].sessionId, null);
  assert.ok(fs.existsSync(launched[0].worktreePath));
  const mgr = createTaskManager(repo);
  await mgr.startPendingSessions({
    callHub: async () => ({ content: [{ type: 'text', text: JSON.stringify({ sessionId: 'sess-api', status: 'running' }) }] }),
  });
  assert.equal(mgr.list().find((t) => t.id === id).sessionId, 'sess-api');
  await mgr.runAgentTurn(id, async (cwd) => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'one.txt'), '1');
  });
  const card = await dispatch(['card'], [id]);
  assert.equal(card.gates, 'pass');
  const log = await dispatch(['get'], [card.verify.ref]);
  assert.match(log, /exit: 0/);
  const disk = readTaskLogRef(card.verify.ref, repo);
  assert.equal(log, disk);
});

test('E_TASK_INVALID si faltan campos', async () => {
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  await assert.rejects(
    () => dispatch(['plan', 'fromList'], [[{ title: 'sin scope' }]]),
    (err) => isSilkaError(err) && err.code === 'E_TASK_INVALID',
  );
});