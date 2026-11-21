import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { claimMergeLease, readMergeOwner } from '../src/silka/merge/owner.mjs';
import { recoverIncompleteMerge } from '../src/silka/merge/recover.mjs';
import { drainMergeQueue, mergeOneTask } from '../src/silka/merge/runner.mjs';
import { refSha } from '../src/silka/merge/git-merge.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { getTask } from '../src/silka/tasks/store.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { runVerifyCommands } from '../src/silka/tasks/verify.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-mq-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'counter.mjs'), 'export let n = 0;\n');
  gitRun(dir, ['add', 'counter.mjs']);
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

async function finishAndApprove(repo, id, turnFn, overrides = {}) {
  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id, ...overrides })]);
  await mgr.runAgentTurn(id, turnFn);
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.state, STATES.LISTA);
  const svc = createReviewService(repo, { actor: 'human' });
  svc.approve(id, { version: task.version });
  return getTask(repo, id);
}

function lease(repo) {
  const l = claimMergeLease(repo);
  assert.equal(l.ok, true);
  return l.fencingToken;
}

test('T-MQ-01 dos tareas semánticas: la segunda repara y main queda verde', async () => {
  const repo = initTempRepo();

  await finishAndApprove(repo, 'mq-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'counter.mjs'), 'export let n = 1;\n');
    fs.writeFileSync(path.join(cwd, 'verify-a.mjs'), `import { n } from './counter.mjs';\nif (n !== 1) process.exit(1);\n`);
  }, { verify: 'node verify-a.mjs', scope: ['counter.mjs'] });

  await finishAndApprove(repo, 'mq-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'counter.mjs'), 'export let n = 0;\nexport const bias = n;\n');
    fs.writeFileSync(path.join(cwd, 'verify-b.mjs'), `import { bias } from './counter.mjs';\nif (bias !== 0) process.exit(1);\n`);
  }, { verify: 'node verify-b.mjs', scope: ['counter.mjs'] });

  const token = lease(repo);
  const first = await mergeOneTask(repo, 'mq-a', { fencingToken: token });
  assert.equal(first.merged, true);

  const token2 = claimMergeLease(repo).fencingToken;
  const second = await mergeOneTask(repo, 'mq-b', { fencingToken: token2 });
  assert.equal(second.repaired, true);

  const b = getTask(repo, 'mq-b');
  assert.equal(b.state, STATES.REPARANDO);

  const verifyMain = runVerifyCommands(repo, [VERIFY_OK]);
  assert.equal(verifyMain.ok, true);
  assert.equal(refSha(repo, 'main'), refSha(repo, 'HEAD'));
});

test('T-MQ-02 caída a medias: diario permite reanudar sin doble mezcla', async () => {
  const repo = initTempRepo();
  await finishAndApprove(repo, 'mq-crash', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'x.txt'), 'ok\n');
  }, { verify: VERIFY_OK, scope: ['x.txt'] });

  const token = lease(repo);
  const prev = process.env.SILKA_MERGE_INJECT;
  process.env.SILKA_MERGE_INJECT = 'after_rebase_before';
  try {
    await assert.rejects(() => mergeOneTask(repo, 'mq-crash', { fencingToken: token }));
  } finally {
    if (prev === undefined) delete process.env.SILKA_MERGE_INJECT;
    else process.env.SILKA_MERGE_INJECT = prev;
  }

  const stillQueued = getTask(repo, 'mq-crash');
  assert.equal(stillQueued.state, STATES.COLA_MEZCLA);

  const token2 = claimMergeLease(repo).fencingToken;
  recoverIncompleteMerge(repo, token2);
  const again = await mergeOneTask(repo, 'mq-crash', { fencingToken: token2 });
  assert.equal(again.merged, true);
  assert.equal(getTask(repo, 'mq-crash').state, STATES.MEZCLADA);
});

test('T-MQ-03 fencing: token viejo aborta la mezcla', async () => {
  const repo = initTempRepo();
  await finishAndApprove(repo, 'mq-fence', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'f.txt'), '1\n');
  }, { verify: VERIFY_OK });

  const token = lease(repo);
  const owner = readMergeOwner(repo);
  await assert.rejects(
    () => mergeOneTask(repo, 'mq-fence', { fencingToken: token - 1 }),
    (err) => isSilkaError(err) && err.code === 'E_FENCING',
  );
  assert.equal(owner.fencingToken, token);
  const ok = await mergeOneTask(repo, 'mq-fence', { fencingToken: token });
  assert.equal(ok.merged, true);
});

test('T-MQ-04 builder con cambios sin commitear: no toca main', async () => {
  const repo = initTempRepo();
  const mainBefore = refSha(repo, 'main');
  await finishAndApprove(repo, 'mq-dirty', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'd.txt'), 'd\n');
  }, { verify: VERIFY_OK });

  fs.writeFileSync(path.join(repo, 'dirty-local.txt'), 'sin commit\n');
  const token = lease(repo);
  const res = await mergeOneTask(repo, 'mq-dirty', { fencingToken: token });
  assert.equal(res.deferred, true);
  assert.equal(res.reason, 'builder_dirty');
  assert.equal(refSha(repo, 'main'), mainBefore);
  assert.equal(getTask(repo, 'mq-dirty').state, STATES.COLA_MEZCLA);

  fs.rmSync(path.join(repo, 'dirty-local.txt'), { force: true });
  const token2 = claimMergeLease(repo).fencingToken;
  const merged = await mergeOneTask(repo, 'mq-dirty', { fencingToken: token2 });
  assert.equal(merged.merged, true);
});

test('T-MQ-05 CAS: movimiento manual de main se reintenta', async () => {
  const repo = initTempRepo();
  await finishAndApprove(repo, 'mq-cas', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'cas.txt'), 'c\n');
  }, { verify: VERIFY_OK });

  const token = lease(repo);
  const task = getTask(repo, 'mq-cas');
  const oldMain = refSha(repo, 'main');

  gitRun(repo, ['commit', '--allow-empty', '-m', 'mueve builder']);
  const movedMain = refSha(repo, 'main');
  assert.notEqual(movedMain, oldMain);

  const res = await mergeOneTask(repo, 'mq-cas', { fencingToken: token });
  assert.equal(res.merged, true);
  assert.notEqual(refSha(repo, 'main'), movedMain);
  assert.ok(fs.existsSync(path.join(repo, 'cas.txt')));
  assert.equal(getTask(repo, 'mq-cas').state, STATES.MEZCLADA);
});

test('drainMergeQueue procesa en FIFO', async () => {
  const repo = initTempRepo();
  await finishAndApprove(repo, 'mq-1', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'one.txt'), '1\n');
  }, { verify: VERIFY_OK });
  await finishAndApprove(repo, 'mq-2', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'two.txt'), '2\n');
  }, { verify: VERIFY_OK });

  const token = lease(repo);
  const a = await drainMergeQueue(repo, { fencingToken: token });
  assert.equal(a.merged, true);
  const token2 = claimMergeLease(repo).fencingToken;
  const b = await drainMergeQueue(repo, { fencingToken: token2 });
  assert.equal(b.merged, true);
});

test('FR-MQ-05 HEAD=dest sucio: difiere sin mover refs/heads/dest', async () => {
  const repo = initTempRepo();
  const mainBefore = refSha(repo, 'main');
  await finishAndApprove(repo, 'mq-hd', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'h.txt'), 'h\n');
  }, { verify: VERIFY_OK });
  fs.writeFileSync(path.join(repo, 'untracked-dirty.txt'), 'u\n');
  const res = await mergeOneTask(repo, 'mq-hd', { fencingToken: lease(repo) });
  assert.equal(res.deferred, true);
  assert.equal(refSha(repo, 'main'), mainBefore);
});

test('FR-MQ-05 HEAD=dest limpio: CAS y reset --hard actualizan el árbol', async () => {
  const repo = initTempRepo();
  await finishAndApprove(repo, 'mq-sync', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'sync.txt'), 's\n');
  }, { verify: VERIFY_OK });
  const res = await mergeOneTask(repo, 'mq-sync', { fencingToken: lease(repo) });
  assert.equal(res.merged, true);
  assert.ok(fs.existsSync(path.join(repo, 'sync.txt')));
});

test('FR-MQ-05 HEAD distinto de dest: solo update-ref, el árbol ajeno intacto', async () => {
  const repo = initTempRepo();
  gitRun(repo, ['checkout', '-b', 'dev']);
  const devTip = refSha(repo, 'dev');
  const mainBefore = refSha(repo, 'main');
  fs.writeFileSync(path.join(repo, 'solo-dev.txt'), 'solo\n');
  await finishAndApprove(repo, 'mq-alt', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'from-queue.txt'), 'q\n');
  }, { verify: VERIFY_OK });
  const res = await mergeOneTask(repo, 'mq-alt', { fencingToken: lease(repo) });
  assert.equal(res.merged, true);
  assert.notEqual(refSha(repo, 'main'), mainBefore);
  assert.equal(refSha(repo, 'dev'), devTip);
  assert.ok(fs.existsSync(path.join(repo, 'solo-dev.txt')));
  assert.ok(!fs.existsSync(path.join(repo, 'from-queue.txt')));
});