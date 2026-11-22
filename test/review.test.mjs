import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApiDispatcher } from '../src/silka/codemode/api-dispatch.mjs';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { escapeAgentText } from '../src/silka/review/escape.mjs';
import { readReviewAudit } from '../src/silka/review/audit.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { mutateTaskStore } from '../src/silka/tasks/store.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rv-'));
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

async function listaTask(repoRoot) {
  const mgr = createTaskManager(repoRoot);
  await mgr.launch([baseTask({ id: 'tk-rv', scope: 'src/rv/' })]);
  await mgr.runAgentTurn('tk-rv', async (cwd) => {
    const file = path.join(cwd, 'src', 'rv', 'f.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'ok');
  });
  const task = mgr.list().find((t) => t.id === 'tk-rv');
  assert.equal(task.state, STATES.LISTA);
  return { mgr, version: task.version, task };
}

test('T-RV-01 aprobar dos veces misma versión: segunda es no-op', async () => {
  const repoRoot = initTempRepo();
  const { version } = await listaTask(repoRoot);
  const svc = createReviewService(repoRoot, { actor: 'human' });
  const first = svc.approve('tk-rv', { version });
  assert.equal(first.noop, false);
  assert.equal(first.state, STATES.COLA_MEZCLA);
  const second = svc.approve('tk-rv', { version });
  assert.equal(second.noop, true);
});

test('T-RV-02 versión vieja tras re-entrega: E_STALE', async () => {
  const repoRoot = initTempRepo();
  const { version: staleVersion } = await listaTask(repoRoot);
  mutateTaskStore(repoRoot, (store) => {
    const row = store.tasks.find((t) => t.id === 'tk-rv');
    row.version = staleVersion + 1;
    return store;
  });
  const svc = createReviewService(repoRoot, { actor: 'human' });
  assert.throws(
    () => svc.approve('tk-rv', { version: staleVersion }),
    (err) => isSilkaError(err) && err.code === 'E_STALE' && err.card?.id === 'tk-rv',
  );
});

test('T-RV-03 manager y riesgo alto: E_POLICY', async () => {
  const repoRoot = initTempRepo();
  const mgr = createTaskManager(repoRoot);
  await mgr.launch([baseTask({ id: 'tk-ci', scope: '.github/workflows/' })]);
  await mgr.runAgentTurn('tk-ci', async (cwd) => {
    const file = path.join(cwd, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: ci\n');
  });
  const task = mgr.list().find((t) => t.id === 'tk-ci');
  const svc = createReviewService(repoRoot, { actor: 'manager' });
  assert.throws(
    () => svc.approve('tk-ci', { version: task.version }),
    (err) => isSilkaError(err) && err.code === 'E_POLICY',
  );
});

test('T-RV-04 ANSI/OSC en resumen del agente escapadas', () => {
  const raw = 'hola \x1b[31maprueba\x1b[0m \x1b]8;;https://evil\x1b\\x';
  const safe = escapeAgentText(raw);
  assert.ok(!safe.includes('\x1b'));
  assert.match(safe, /hola/);
  assert.match(safe, /aprueba/);
});

test('T-RV-05 rechazar con nota: misma conversación', async () => {
  const repoRoot = initTempRepo();
  const mgr = createTaskManager(repoRoot);
  await mgr.launch([baseTask({ id: 'tk-note', scope: 'src/n/' })]);
  await mgr.runAgentTurn('tk-note', async (cwd) => {
    const file = path.join(cwd, 'src', 'n', 'f.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
  });
  const task = mgr.list().find((t) => t.id === 'tk-note');
  mutateTaskStore(repoRoot, (store) => {
    const row = store.tasks.find((t) => t.id === 'tk-note');
    row.sessionId = 'sess-note';
    return store;
  });
  const sent = [];
  const svc = createReviewService(repoRoot, {
    actor: 'human',
    callHub: async (name, args) => {
      if (name === 'agent_session_send') sent.push(args);
    },
  });
  await svc.reject('tk-note', 'corrige tests', { version: task.version });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionId, 'sess-note');
  assert.equal(sent[0].message, 'corrige tests');
  const after = mgr.list().find((t) => t.id === 'tk-note');
  assert.equal(after.state, STATES.TRABAJANDO);
});

test('auditoría en .silka/reviews.jsonl', async () => {
  const repoRoot = initTempRepo();
  const { version } = await listaTask(repoRoot);
  const svc = createReviewService(repoRoot, { actor: 'human' });
  svc.approve('tk-rv', { version });
  const audit = readReviewAudit(repoRoot);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].decision, 'approve');
  assert.equal(audit[0].actor, 'human');
});

test('review.inbox por Code Mode', async () => {
  const repoRoot = initTempRepo();
  await listaTask(repoRoot);
  const dispatch = createApiDispatcher({
    workspace: repoRoot,
    callHub: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const inbox = await dispatch(['review', 'inbox'], []);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, 'tk-rv');
  assert.ok(inbox[0].diffStats);
  assert.ok(!inbox[0].diff?.summary);
});