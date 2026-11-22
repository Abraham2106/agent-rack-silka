// Pruebas de conformidad con openspec/specs/integration-waves/spec.md
// Cubre los escenarios I-WV-01..05, incluida la preservación de la historia
// (los SHA previos de la rama destino siguen siendo ancestros, I-WV-05).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { refSha } from '../src/silka/merge/git-merge.mjs';
import { claimMergeLease } from '../src/silka/merge/owner.mjs';
import { drainMergeQueue, mergeOneTask } from '../src/silka/merge/runner.mjs';
import { parsePlanDocument } from '../src/silka/integration/parse.mjs';
import { readIntegrationJournal } from '../src/silka/integration/journal.mjs';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-iwspec-'));
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

test('I-WV-01 la integración corre al completar cada oleada mezclada', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-spec-two-waves',
    integration: { verify: INTEGRATION },
    tasks: [
      baseTask('sw0-a', { scope: ['state.mjs'] }),
      baseTask('sw1-b', { scope: ['state.mjs'], dependsOn: ['sw0-a'] }),
    ],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);

  await finishAndApprove(repo, 'sw0-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await mergeAll(repo);

  const mid = buildPlanStatus(repo, 'pl-spec-two-waves');
  assert.equal(mid.waves.length, 2);
  assert.equal(mid.waves[0].status, 'passed');
  assert.ok(mid.waves[0].evidence);
  assert.equal(mid.waves[1].status, 'pending');

  await finishAndApprove(repo, 'sw1-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 1;\n');
  }, { scope: ['state.mjs', 'bias.mjs'] });
  await mergeAll(repo);

  const end = buildPlanStatus(repo, 'pl-spec-two-waves');
  assert.equal(end.waves[1].status, 'passed');
  assert.ok(end.waves[1].passedAtCommit);
});

test('I-WV-02 culpable identificado, reparación encolada y oleada siguiente bloqueada', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-spec-culprit',
    integration: { verify: INTEGRATION },
    waves: [['sc-a', 'sc-b'], ['sc-next']],
    tasks: [
      baseTask('sc-a', { scope: ['state.mjs'] }),
      baseTask('sc-b', { scope: ['bias.mjs'] }),
      baseTask('sc-next', { dependsOn: [] }),
    ],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);

  await finishAndApprove(repo, 'sc-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await finishAndApprove(repo, 'sc-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 0;\n');
  });
  await mergeAll(repo);

  const plan = getPlan(repo, 'pl-spec-culprit');
  assert.equal(plan.wavesState[0].status, 'failed');
  assert.equal(plan.wavesState[0].culpritTaskId, 'sc-b');

  const repair = getTask(repo, 'sc-b-int-repair');
  assert.ok(repair, 'la reparación ligada al culpable queda encolada');
  assert.equal(repair.integrationRepairFor, 'sc-b');

  const next = getTask(repo, 'sc-next');
  assert.equal(next.state, STATES.BLOQUEADA);
  assert.ok(next.blockedReason?.includes('oleada 0'));
});

test('I-WV-03 fallo solo por combinación genera ficha de oleada con riesgo alto', async () => {
  const repo = initTempRepo();
  fs.writeFileSync(path.join(repo, 'integration-check.mjs'), 'process.exit(1);\n');
  gitRun(repo, ['add', 'integration-check.mjs']);
  gitRun(repo, ['commit', '-m', 'always fail integration']);

  const doc = parsePlanDocument({
    planId: 'pl-spec-noculp',
    integration: { verify: INTEGRATION },
    tasks: [baseTask('sn-a')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);
  await finishAndApprove(repo, 'sn-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await mergeAll(repo);

  const plan = getPlan(repo, 'pl-spec-noculp');
  assert.equal(plan.wavesState[0].status, 'failed');
  assert.equal(plan.wavesState[0].culpritTaskId, null);
  assert.ok(plan.wavesState[0].waveCard);
  assert.equal(plan.wavesState[0].waveCard.risk, 'alto');

  const card = listInbox(repo).find((i) => i.id === 'wave:pl-spec-noculp:0');
  assert.ok(card, 'la ficha de oleada aparece en la bandeja');
  assert.equal(card.risk, 'alto');
});

test('I-WV-04 el reinicio a mitad retoma sin duplicar pasos del diario', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-spec-resume',
    integration: { verify: INTEGRATION },
    tasks: [baseTask('sr-a')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);
  await finishAndApprove(repo, 'sr-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 1;\n');
  }, { scope: ['state.mjs', 'bias.mjs'] });

  const prev = process.env.SILKA_INTEGRATION_INJECT;
  process.env.SILKA_INTEGRATION_INJECT = 'after_verify';
  try {
    const token = lease(repo);
    await assert.rejects(() => mergeOneTask(repo, 'sr-a', { fencingToken: token }));
  } finally {
    if (prev === undefined) delete process.env.SILKA_INTEGRATION_INJECT;
    else process.env.SILKA_INTEGRATION_INJECT = prev;
  }

  const mid = getPlan(repo, 'pl-spec-resume');
  assert.equal(mid.wavesState[0].status, 'running');

  const journalMid = readIntegrationJournal(repo).filter(
    (e) => e.planId === 'pl-spec-resume' && e.waveIndex === 0,
  );
  assert.equal(journalMid.filter((e) => e.kind === 'run_start').length, 1);
  assert.equal(journalMid.filter((e) => e.kind === 'run_done').length, 0);

  const out = recoverIntegrationRun(repo, 'pl-spec-resume', 0);
  assert.ok(out.ok);

  const end = getPlan(repo, 'pl-spec-resume');
  assert.equal(end.wavesState[0].status, 'passed');

  const journalEnd = readIntegrationJournal(repo).filter(
    (e) => e.planId === 'pl-spec-resume' && e.waveIndex === 0,
  );
  assert.equal(journalEnd.filter((e) => e.kind === 'run_start').length, 1, 'no reanuda duplicando run_start');
  assert.equal(journalEnd.filter((e) => e.kind === 'run_done' && e.ok).length, 1);
});

test('I-WV-05 los SHA previos de la rama destino siguen siendo ancestros', async () => {
  const repo = initTempRepo();
  const doc = parsePlanDocument({
    planId: 'pl-spec-ancestors',
    integration: { verify: INTEGRATION },
    waves: [['sa-a', 'sa-b']],
    tasks: [baseTask('sa-a'), baseTask('sa-b')],
  }, { repoRoot: repo });

  await launchDoc(repo, doc);

  const shaBase = refSha(repo, 'main');
  await finishAndApprove(repo, 'sa-a', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'state.mjs'), 'export let n = 1;\n');
  });
  await mergeAll(repo);
  const shaAfterA = refSha(repo, 'main');

  await finishAndApprove(repo, 'sa-b', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'bias.mjs'), 'export const bias = 0;\n');
  }, { scope: ['bias.mjs'] });
  await mergeAll(repo);

  const tip = refSha(repo, 'main');
  for (const sha of [shaBase, shaAfterA]) {
    const anc = gitRun(repo, ['merge-base', '--is-ancestor', sha, tip], { repoRoot: repo });
    assert.equal(anc.ok, true, `${sha} debe seguir siendo ancestro de ${tip}`);
  }
  assert.notEqual(tip, shaAfterA);
});
