import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { refSha } from '../src/silka/merge/git-merge.mjs';
import { claimMergeLease } from '../src/silka/merge/owner.mjs';
import { drainMergeQueue, mergeOneTask } from '../src/silka/merge/runner.mjs';
import { parsePlanDocument } from '../src/silka/integration/parse.mjs';
import { registerPlanInStore, recoverIntegrationRun } from '../src/silka/integration/runner.mjs';
import { buildPlanStatus } from '../src/silka/integration/service.mjs';
import { getPlan } from '../src/silka/integration/store.mjs';
import { listInbox } from '../src/silka/review/inbox.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { getTask } from '../src/silka/tasks/store.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

const TASK_VERIFY = 'node -e "process.exit(0)"';
const INTEGRATION = 'node integration-check.mjs';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-int-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'state.mjs'), 'export let n = 0;\n');
  fs.writeFileSync(
    path.join(dir, 'integration-check.mjs'),
    [
      "import { existsSync } from 'node:fs';",
      "import { n } from './state.mjs';",
      "if (!existsSync('bias.mjs')) process.exit(0);",
      "const { bias } = await import('./bias.mjs');",
      'if (n + bias !== 2) process.exit(1);',
    ].join('\n'),
  );
  gitRun(dir, ['add', '.']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

function writeIntegrationCheck(repo) {
  if (!fs.existsSync(path.join(repo, 'integration-check.mjs'))) {
    fs.writeFileSync(
      path.join(repo, 'integration-check.mjs'),
      "import { existsSync } from 'node:fs';\nimport { n } from './state.mjs';\nif (!existsSync('bias.mjs')) process.exit(0);\nconst { bias } = await import('./bias.mjs');\nif (n + bias !== 2) process.exit(1);\n",
    );
    gitRun(repo, ['add', 'integration-check.mjs']);
    gitRun(repo, ['commit', '-m', 'add integration check']);
  }
}

function baseTask(id, overrides = {}) {
  return {
    id,
    title: id,
    scope: 'state.mjs',
    deliver: 'cambio',
    verify: TASK_VERIFY,
    ...overrides,
  };
}

async function finishAndApprove(repo, id, turnFn, overrides = {}) {
  const mgr = createTaskManager(repo);
  if (!getTask(repo, id)) {
    await mgr.launch([baseTask(id, overrides)]);
  } else {
    mgr.schedule({ manual: true });
  }
  await mgr.runAgentTurn(id, turnFn);
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.state, STATES.LISTA);
  const svc = createReviewService(repo, { actor: 'human' });
  svc.approve(id, { version: task.version });
  return getTask(repo, id);
}

function launchDoc(repo, doc) {
  writeIntegrationCheck(repo);
  registerPlanInStore(repo, doc.plan, refSha(repo, 'main'));
  const mgr = createTaskManager(repo);
  return mgr.launch(doc.tasks, { manual: true });
}

function lease(repo) {
  const l = claimMergeLease(repo);
  assert.equal(l.ok, true);
  return l.fencingToken;
}

async function mergeAll(repo) {
  while (true) {
    const token = lease(repo);
    const res = await drainMergeQueue(repo, { fencingToken: token });
    if (!res.processed) break;
  }
}

test('I-WV-01 dos oleadas con integración pasan en secuencia', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-two-waves',
    integration: { verify: INTEGRATION },
    tasks: [
      baseTask('w0-a', { scope: ['state.mjs'] }),
      baseTask('w1-b', { scope: ['state.mjs'], dependsOn: ['w0-a'] }),
    ],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);

  await finishAndApprove(repo, 'w0-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await mergeAll(repo);

  const planMid = buildPlanStatus(repo, 'pl-two-waves');
  assert.equal(planMid.waves[0].status, 'passed');

  await finishAndApprove(repo, 'w1-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 1;\n');
  }, { scope: ['state.mjs', 'bias.mjs'] });
  await mergeAll(repo);

  const planEnd = buildPlanStatus(repo, 'pl-two-waves');
  assert.equal(planEnd.waves[1].status, 'passed');
});

test('I-WV-02 culpable en oleada combinada y oleada siguiente bloqueada', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-culprit',
    integration: { verify: INTEGRATION },
    waves: [['ca', 'cb'], ['c-next']],
    tasks: [
      baseTask('ca', { scope: ['state.mjs'] }),
      baseTask('cb', { scope: ['bias.mjs'] }),
      baseTask('c-next', { dependsOn: [] }),
    ],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);

  await finishAndApprove(repo, 'ca', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await finishAndApprove(repo, 'cb', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 0;\n');
  });
  await mergeAll(repo);

  const plan = getPlan(repo, 'pl-culprit');
  assert.equal(plan.wavesState[0].status, 'failed');
  assert.equal(plan.wavesState[0].culpritTaskId, 'cb');

  const next = getTask(repo, 'c-next');
  assert.equal(next.state, STATES.BLOQUEADA);
  assert.ok(next.blockedReason?.includes('oleada 0'));
});

test('I-WV-03 fallo sin culpable genera ficha de oleada en bandeja', async () => {
  const repo = initTempRepo();
  fs.writeFileSync(
    path.join(repo, 'integration-check.mjs'),
    'process.exit(1);\n',
  );
  gitRun(repo, ['add', 'integration-check.mjs']);
  gitRun(repo, ['commit', '-m', 'always fail integration']);

  const doc = parsePlanDocument({
    planId: 'pl-noculp',
    integration: { verify: INTEGRATION },
    tasks: [baseTask('nc-a')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);
  await finishAndApprove(repo, 'nc-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await mergeAll(repo);

  const plan = getPlan(repo, 'pl-noculp');
  assert.ok(plan.wavesState[0].waveCard);
  const inbox = listInbox(repo);
  assert.ok(inbox.some((i) => i.id === 'wave:pl-noculp:0'));
  assert.equal(inbox.find((i) => i.id === 'wave:pl-noculp:0').risk, 'alto');
});

test('I-WV-04 reinicio a mitad de integración retoma sin duplicar', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-resume',
    integration: { verify: INTEGRATION },
    tasks: [baseTask('rs-a')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);
  await finishAndApprove(repo, 'rs-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 1;\n');
  }, { scope: ['state.mjs', 'bias.mjs'] });

  const prev = process.env.SILKA_INTEGRATION_INJECT;
  process.env.SILKA_INTEGRATION_INJECT = 'after_verify';
  try {
    const token = lease(repo);
    await assert.rejects(() => mergeOneTask(repo, 'rs-a', { fencingToken: token }));
  } finally {
    if (prev === undefined) delete process.env.SILKA_INTEGRATION_INJECT;
    else process.env.SILKA_INTEGRATION_INJECT = prev;
  }

  const mid = getPlan(repo, 'pl-resume');
  assert.equal(mid.wavesState[0].status, 'running');

  const out = recoverIntegrationRun(repo, 'pl-resume', 0);
  assert.ok(out.ok);

  const end = getPlan(repo, 'pl-resume');
  assert.equal(end.wavesState[0].status, 'passed');
});

test('I-WV-05 la rama destino no se reescribe: SHAs previos siguen siendo ancestros', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-ancestors',
    integration: { verify: INTEGRATION },
    waves: [['an-a', 'an-b']],
    tasks: [baseTask('an-a'), baseTask('an-b')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);
  await finishAndApprove(repo, 'an-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  const shaBeforeB = refSha(repo, 'main');

  await finishAndApprove(repo, 'an-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 0;\n');
  }, { scope: ['bias.mjs'] });
  await mergeAll(repo);

  const tip = refSha(repo, 'main');
  const anc = gitRun(repo, ['merge-base', '--is-ancestor', shaBeforeB, tip], { repoRoot: repo });
  assert.equal(anc.ok, true);
  assert.notEqual(tip, shaBeforeB);
});