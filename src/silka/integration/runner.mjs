import crypto from 'node:crypto';
import { mergeDestBranch, refSha } from '../merge/git-merge.mjs';
import { buildRepairMessage } from '../tasks/repair.mjs';
import { createTaskManager } from '../tasks/manager.mjs';
import { getTask, mutateTaskStore, newTaskId } from '../tasks/store.mjs';
import { STATES } from '../tasks/states.mjs';
import { appendIntegrationJournal, lastOpenIntegrationRun } from './journal.mjs';
import { getPlan, upsertPlan, waveState } from './store.mjs';
import { withDetachedWorktree } from './worktree.mjs';
import { runIntegrationChecks } from './verify.mjs';

function injectCrash(point) {
  if (process.env.SILKA_INTEGRATION_INJECT === point) {
    const err = new Error(`INJECT:${point}`);
    err.code = 'INJECT';
    throw err;
  }
}

function waveTasksMerged(repoRoot, plan, waveIndex) {
  const ids = plan.waves[waveIndex] || [];
  return ids.every((id) => {
    const t = getTask(repoRoot, id);
    return t && t.state === STATES.MEZCLADA;
  });
}

function baselineForWave(plan, waveIndex) {
  if (waveIndex === 0) return plan.destBaseline;
  const prev = plan.wavesState?.[waveIndex - 1];
  return prev?.passedAtCommit || plan.destBaseline;
}

function runAtCommit(repoRoot, plan, commitSha, opts = {}) {
  return withDetachedWorktree(repoRoot, commitSha, (cwd) => {
    return runIntegrationChecks(repoRoot, cwd, plan.integration, opts);
  }, { tag: plan.id });
}

export function integrationBlockedReason(repoRoot, task) {
  if (!task?.planId) return null;
  const plan = getPlan(repoRoot, task.planId);
  if (!plan) return null;
  const wave = Number(task.wave) || 0;
  if (wave > 0) {
    const prev = plan.wavesState?.[wave - 1];
    if (prev?.status !== 'passed') {
      return prev?.blockedReason || `oleada ${wave - 1} sin integración aprobada`;
    }
  }
  const cur = plan.wavesState?.[wave];
  if (cur?.status === 'failed' && cur?.waveCard) {
    return 'integración de oleada fallida (revisión humana)';
  }
  if (cur?.status === 'running') {
    return 'integración de oleada en curso';
  }
  return null;
}

function blockTasksInLaterWaves(repoRoot, plan, fromWave, reason) {
  mutateTaskStore(repoRoot, (store) => {
    for (const t of store.tasks) {
      if (t.planId !== plan.id) continue;
      if (Number(t.wave) <= fromWave) continue;
      if (t.state === STATES.MEZCLADA || t.state === STATES.DESCARTADA) continue;
      if (t.state === STATES.BLOQUEADA && t.blockedReason === reason) continue;
      const from = t.state;
      t.blockedReason = reason;
      if (t.state !== STATES.BLOQUEADA) {
        t.state = STATES.BLOQUEADA;
        t.version = (Number(t.version) || 0) + 1;
        t.transitions = t.transitions || [];
        t.transitions.push({
          at: new Date().toISOString(),
          from,
          to: STATES.BLOQUEADA,
          cause: 'oleada_integración',
        });
      }
    }
    return store;
  });
}

function unblockWaveAfterPass(repoRoot, plan, waveIndex) {
  mutateTaskStore(repoRoot, (store) => {
    for (const t of store.tasks) {
      if (t.planId !== plan.id) continue;
      if (Number(t.wave) !== waveIndex + 1) continue;
      if (t.state !== STATES.BLOQUEADA) continue;
      if (t.blockedReason?.includes('oleada')) {
        t.blockedReason = null;
        if (t.dependsOn?.length) {
          t.state = STATES.ESPERANDO_DEPS;
        } else {
          t.state = STATES.PLANIFICADA;
        }
        t.version = (Number(t.version) || 0) + 1;
      }
    }
    return store;
  });
  const mgr = createTaskManager(repoRoot, { preferManual: true });
  mgr.schedule({ manual: true });
}

function findCulprit(repoRoot, plan, waveIndex) {
  const ws = waveState(plan, waveIndex);
  const merges = ws.mergeCommits || [];
  const baseline = baselineForWave(plan, waveIndex);
  const runId = `cul-${crypto.randomBytes(3).toString('hex')}`;
  const prior = lastOpenIntegrationRun(repoRoot, plan.id, waveIndex);
  if (prior.phase === 'culprit' && prior.runId) {
    appendIntegrationJournal(repoRoot, { kind: 'culprit_done', planId: plan.id, waveIndex, runId: prior.runId, resume: true });
  }
  appendIntegrationJournal(repoRoot, { kind: 'culprit_start', planId: plan.id, waveIndex, runId });

  if (baseline && !runAtCommit(repoRoot, plan, baseline).ok) {
    appendIntegrationJournal(repoRoot, { kind: 'culprit_done', planId: plan.id, waveIndex, runId, culprit: null });
    return { culpritTaskId: null, reason: 'baseline' };
  }

  for (let i = merges.length - 1; i >= 0; i -= 1) {
    injectCrash('during_culprit');
    const sha = i === 0 ? baseline : merges[i - 1].commit;
    if (!sha) continue;
    const ok = runAtCommit(repoRoot, plan, sha).ok;
    if (ok) {
      appendIntegrationJournal(repoRoot, {
        kind: 'culprit_done',
        planId: plan.id,
        waveIndex,
        runId,
        culprit: merges[i].taskId,
      });
      return { culpritTaskId: merges[i].taskId, afterCommit: sha, failCommit: merges[i].commit };
    }
  }
  appendIntegrationJournal(repoRoot, { kind: 'culprit_done', planId: plan.id, waveIndex, runId, culprit: null });
  return { culpritTaskId: null, reason: 'combinación' };
}

function buildWaveCard(plan, waveIndex, evidence) {
  return {
    kind: 'wave_integration_failed',
    planId: plan.id,
    wave: waveIndex,
    at: new Date().toISOString(),
    title: `Oleada ${waveIndex}: integración fallida (sin culpable)`,
    risk: 'alto',
    gates: 'fail',
    evidence: evidence || [],
    declared: [],
    agentSays: '',
    agentSaysFrom: 'silka',
    verify: { ok: false },
  };
}

function createIntegrationRepair(repoRoot, plan, culpritTaskId, { evidence }) {
  const culprit = getTask(repoRoot, culpritTaskId);
  if (!culprit) return null;
  const repairId = `${culpritTaskId}-int-repair`;
  if (getTask(repoRoot, repairId)) return repairId;
  const enriched = (evidence || []).filter((e) => !e.ok);
  const message = buildRepairMessage({ evidence: enriched, verifyRef: null });
  const spec = {
    id: repairId,
    title: `Reparación integración: ${culprit.title}`,
    scope: culprit.scope,
    deliver: `Corregir fallo de integración de oleada ${culprit.wave} tras mezcla.`,
    verify: culprit.verify,
    accept: culprit.accept,
    allowNoVerify: culprit.allowNoVerify,
    maxRepairs: plan.integration?.maxRepairs ?? 2,
    dependsOn: [],
    planId: plan.id,
    wave: culprit.wave,
    integrationRepairFor: culpritTaskId,
  };
  const mgr = createTaskManager(repoRoot, { preferManual: true });
  mgr.registerPlan([spec], { cause: 'integración_culpable' });
  mutateTaskStore(repoRoot, (store) => {
    const row = store.tasks.find((t) => t.id === repairId);
    if (row) {
      row.pendingRepair = { id: `${repairId}-msg`, message };
      if (culprit.sessionId) row.sessionId = culprit.sessionId;
    }
    return store;
  });
  return repairId;
}

export function runWaveIntegration(repoRoot, planId, waveIndex, { callHub, timeoutMs } = {}) {
  const plan = getPlan(repoRoot, planId);
  if (!plan?.integration) return { skipped: true };
  const ws = waveState(plan, waveIndex);
  if (ws.status === 'passed') return { skipped: true, reason: 'already_passed' };

  const prior = lastOpenIntegrationRun(repoRoot, planId, waveIndex);
  const runId = prior.phase === 'running' && prior.runId
    ? prior.runId
    : `int-${crypto.randomBytes(3).toString('hex')}`;
  ws.status = 'running';
  ws.blockedReason = 'integración en curso';
  plan.wavesState[waveIndex] = ws;
  upsertPlan(repoRoot, plan);
  if (!(prior.phase === 'running' && prior.runId)) {
    appendIntegrationJournal(repoRoot, { kind: 'run_start', planId, waveIndex, runId });
  }

  const dest = mergeDestBranch(repoRoot);
  const tip = refSha(repoRoot, dest);
  injectCrash('before_verify');

  let result;
  try {
    result = runAtCommit(repoRoot, plan, tip, { timeoutMs, taskId: `${planId}-w${waveIndex}` });
  } catch (err) {
    ws.status = 'running';
    plan.wavesState[waveIndex] = ws;
    upsertPlan(repoRoot, plan);
    throw err;
  }

  injectCrash('after_verify');

  if (result.ok) {
    ws.status = 'passed';
    ws.passedAtCommit = tip;
    ws.evidence = result.evidence;
    ws.blockedReason = null;
    plan.wavesState[waveIndex] = ws;
    upsertPlan(repoRoot, plan);
    appendIntegrationJournal(repoRoot, { kind: 'run_done', planId, waveIndex, runId, ok: true, commit: tip });
    unblockWaveAfterPass(repoRoot, getPlan(repoRoot, planId), waveIndex);
    return { ok: true, commit: tip };
  }

  ws.evidence = result.evidence;
  const culprit = findCulprit(repoRoot, plan, waveIndex);
  if (culprit.culpritTaskId) {
    ws.status = 'failed';
    ws.culpritTaskId = culprit.culpritTaskId;
    ws.blockedReason = `culpable: ${culprit.culpritTaskId}`;
    plan.wavesState[waveIndex] = ws;
    upsertPlan(repoRoot, plan);
    const repairId = createIntegrationRepair(repoRoot, plan, culprit.culpritTaskId, { evidence: result.evidence });
    blockTasksInLaterWaves(repoRoot, plan, waveIndex, `oleada ${waveIndex} en reparación (${culprit.culpritTaskId})`);
    appendIntegrationJournal(repoRoot, {
      kind: 'run_done',
      planId,
      waveIndex,
      runId,
      ok: false,
      culprit: culprit.culpritTaskId,
      repairId,
    });
    return { ok: false, culpritTaskId: culprit.culpritTaskId, repairId };
  }

  ws.status = 'failed';
  ws.waveCard = buildWaveCard(plan, waveIndex, result.evidence);
  ws.blockedReason = 'integración fallida sin culpable';
  plan.wavesState[waveIndex] = ws;
  upsertPlan(repoRoot, plan);
  blockTasksInLaterWaves(repoRoot, plan, waveIndex, 'integración de oleada fallida (revisión humana)');
  appendIntegrationJournal(repoRoot, { kind: 'run_done', planId, waveIndex, runId, ok: false, waveCard: true });
  return { ok: false, waveCard: true };
}

export function recordWaveMergeCommit(repoRoot, taskId) {
  const task = getTask(repoRoot, taskId);
  if (!task?.planId) return;
  const plan = getPlan(repoRoot, task.planId);
  if (!plan) return;
  const wave = Number(task.wave) || 0;
  const dest = mergeDestBranch(repoRoot);
  const commit = refSha(repoRoot, dest);
  mutateTaskStore(repoRoot, (store) => {
    const row = store.tasks.find((t) => t.id === taskId);
    if (row) row.mergeCommit = commit;
    return store;
  });
  const ws = waveState(plan, wave);
  if (!ws.mergeCommits.some((m) => m.taskId === taskId)) {
    ws.mergeCommits.push({ taskId, commit, at: new Date().toISOString() });
  }
  plan.wavesState[wave] = ws;
  upsertPlan(repoRoot, plan);
}

export async function afterTaskMerged(repoRoot, taskId, opts = {}) {
  const task = getTask(repoRoot, taskId);
  if (!task?.planId) return { skipped: true };
  const plan = getPlan(repoRoot, task.planId);
  if (!plan) return { skipped: true };
  recordWaveMergeCommit(repoRoot, taskId);
  const wave = Number(task.wave) || 0;

  if (task.integrationRepairFor) {
    const freshPlan = getPlan(repoRoot, plan.id);
    const ws = waveState(freshPlan, wave);
    if (ws.status === 'failed') {
      ws.status = 'pending';
      ws.culpritTaskId = null;
      ws.blockedReason = null;
      freshPlan.wavesState[wave] = ws;
      upsertPlan(repoRoot, freshPlan);
      recordWaveMergeCommit(repoRoot, taskId);
      return runWaveIntegration(repoRoot, plan.id, wave, opts);
    }
  }

  const fresh = getPlan(repoRoot, plan.id);
  if (!waveTasksMerged(repoRoot, fresh, wave)) {
    return { waiting: true, wave };
  }
  return runWaveIntegration(repoRoot, plan.id, wave, opts);
}

export function recoverIntegrationRun(repoRoot, planId, waveIndex) {
  const plan = getPlan(repoRoot, planId);
  if (!plan) return { skipped: true };
  const prior = lastOpenIntegrationRun(repoRoot, planId, waveIndex);
  if (!prior.runId) return { skipped: true };
  if (prior.phase === 'running') {
    return runWaveIntegration(repoRoot, planId, waveIndex, {});
  }
  if (prior.phase === 'culprit') {
    const ws = waveState(plan, waveIndex);
    ws.status = 'running';
    upsertPlan(repoRoot, plan);
    return runWaveIntegration(repoRoot, planId, waveIndex, {});
  }
  return { skipped: true };
}

export function registerPlanInStore(repoRoot, plan, destBaseline) {
  const row = {
    ...plan,
    destBaseline: destBaseline || plan.destBaseline,
    createdAt: plan.createdAt || new Date().toISOString(),
  };
  upsertPlan(repoRoot, row);
  return row;
}