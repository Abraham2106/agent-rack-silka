import fs from 'node:fs';
import { silkaError } from '../codemode/errors.mjs';
import { appendMetric } from '../metrics/record.mjs';
import { createTaskManager } from '../tasks/manager.mjs';
import { getTask, mutateTaskStore } from '../tasks/store.mjs';
import { STATES } from '../tasks/states.mjs';
import { assertVerifyDeclared, runVerifyCommands } from '../tasks/verify.mjs';
import { portsEnv } from '../tasks/ports.mjs';
import { branchName } from '../tasks/worktree.mjs';
import { appendJournal } from './journal.mjs';
import {
  ensureDeliveryCommit,
  mergeDestBranch,
  rebaseOntoTarget,
  refSha,
  shouldDeferForDirtyBuilder,
  syncBuilderToDestAfterCas,
  updateRefCas,
} from './git-merge.mjs';
import { assertFencing } from './owner.mjs';
import { clearMergeRuntime, writeMergeRuntime } from './state.mjs';
import { listMergeQueue } from './queue.mjs';

function injectCrash(point) {
  if (process.env.SILKA_MERGE_INJECT === point) {
    const err = new Error(`INJECT:${point}`);
    err.code = 'INJECT';
    throw err;
  }
}

function formatMergeError(kind, detail) {
  return { kind, ...detail };
}

async function sendRepairMessage(callHub, task, text) {
  if (!callHub || !task?.sessionId || !text) return;
  await callHub('agent_session_send', { sessionId: task.sessionId, message: text });
}

export async function mergeOneTask(repoRoot, taskId, { fencingToken, callHub, verifyTimeoutMs } = {}) {
  assertFencing(repoRoot, fencingToken);
  const mgr = createTaskManager(repoRoot, { verifyTimeoutMs, preferManual: true });
  const task = getTask(repoRoot, taskId);
  if (!task || task.state !== STATES.COLA_MEZCLA) return { skipped: true };

  const dest = mergeDestBranch(repoRoot);
  if (shouldDeferForDirtyBuilder(repoRoot, dest)) {
    mutateTaskStore(repoRoot, (store) => {
      const row = store.tasks.find((t) => t.id === taskId);
      if (row) row.mergeDeferredReason = 'builder_dirty';
      return store;
    });
    return { deferred: true, reason: 'builder_dirty' };
  }
  const branch = task.branch || branchName(taskId);
  const wt = task.worktreePath;
  if (!wt || !fs.existsSync(wt)) {
    throw silkaError('E_TASK_INVALID', `Worktree ausente para ${taskId}`);
  }

  writeMergeRuntime(repoRoot, { taskId, step: 'rebase', fencingToken });

  const delivery = ensureDeliveryCommit(wt, taskId, { repoRoot });
  if (delivery.ok === false) {
    clearMergeRuntime(repoRoot);
    const detail = formatMergeError('commit', { stderr: delivery.stderr });
    mgr.failMerge(taskId, detail, { callHub });
    return { repaired: true, detail };
  }

  const oldDest = refSha(repoRoot, dest);
  appendJournal(repoRoot, {
    phase: 'before',
    step: 'rebase',
    taskId,
    fencingToken,
    targetRef: `refs/heads/${dest}`,
    targetOld: oldDest,
    worktreePath: wt,
    branch,
  });
  injectCrash('after_rebase_before');

  const rebase = rebaseOntoTarget(wt, dest, { repoRoot });
  appendJournal(repoRoot, {
    phase: 'after',
    step: 'rebase',
    taskId,
    fencingToken,
    ok: rebase.ok,
    paths: rebase.paths || [],
  });
  injectCrash('after_rebase');

  if (!rebase.ok) {
    clearMergeRuntime(repoRoot);
    const detail = formatMergeError(rebase.kind || 'rebase', {
      paths: rebase.paths || [],
      stderr: rebase.stderr,
      stdout: rebase.stdout,
    });
    const text = JSON.stringify(detail, null, 2);
    mgr.failMerge(taskId, detail, { callHub });
    await sendRepairMessage(callHub, getTask(repoRoot, taskId), text);
    return { repaired: true, detail };
  }

  writeMergeRuntime(repoRoot, { taskId, step: 'verify', fencingToken });
  const verifyCmds = assertVerifyDeclared(task.verify);
  appendJournal(repoRoot, { phase: 'before', step: 'verify', taskId, fencingToken });
  injectCrash('during_verify');

  const { ok, log } = runVerifyCommands(wt, verifyCmds, {
    timeoutMs: verifyTimeoutMs ?? 120_000,
    env: portsEnv(task.allocatedPorts),
  });
  appendJournal(repoRoot, { phase: 'after', step: 'verify', taskId, fencingToken, ok });
  injectCrash('after_verify');

  if (!ok) {
    clearMergeRuntime(repoRoot);
    const detail = formatMergeError('verify', { log });
    mgr.failMerge(taskId, detail, { callHub });
    await sendRepairMessage(callHub, getTask(repoRoot, taskId), log);
    return { repaired: true, detail };
  }

  const newTip = refSha(wt, 'HEAD');
  const destBefore = refSha(repoRoot, dest);
  writeMergeRuntime(repoRoot, { taskId, step: 'fast_forward', fencingToken });
  appendJournal(repoRoot, {
    phase: 'before',
    step: 'fast_forward',
    taskId,
    fencingToken,
    targetRef: `refs/heads/${dest}`,
    expectedOld: destBefore,
    expectedNew: newTip,
  });
  injectCrash('before_fast_forward_after');

  let cas = updateRefCas(repoRoot, `refs/heads/${dest}`, newTip, destBefore);
  if (!cas.ok) {
    const moved = refSha(repoRoot, dest);
    if (moved !== destBefore) {
      const refreshed = refSha(repoRoot, branch);
      const latestDest = refSha(repoRoot, dest);
      appendJournal(repoRoot, {
        phase: 'before',
        step: 'rebase',
        taskId,
        fencingToken,
        retry: true,
        targetOld: latestDest,
      });
      const retryRebase = rebaseOntoTarget(wt, dest, { repoRoot });
      appendJournal(repoRoot, {
        phase: 'after',
        step: 'rebase',
        taskId,
        fencingToken,
        retry: true,
        ok: retryRebase.ok,
      });
      if (!retryRebase.ok) {
        clearMergeRuntime(repoRoot);
        const detail = formatMergeError('rebase', { paths: retryRebase.paths, stderr: retryRebase.stderr });
        mgr.failMerge(taskId, detail, { callHub });
        return { repaired: true, detail };
      }
      const newDest = refSha(repoRoot, dest);
      const newTip2 = refSha(repoRoot, branch);
      cas = updateRefCas(repoRoot, `refs/heads/${dest}`, newTip2, newDest);
    }
  }

  appendJournal(repoRoot, {
    phase: 'after',
    step: 'fast_forward',
    taskId,
    fencingToken,
    ok: cas.ok,
  });
  injectCrash('after_fast_forward');

  if (!cas.ok) {
    clearMergeRuntime(repoRoot);
    const detail = formatMergeError('cas', { stderr: cas.stderr });
    mgr.failMerge(taskId, detail, { callHub });
    return { repaired: true, detail };
  }

  syncBuilderToDestAfterCas(repoRoot, dest);

  clearMergeRuntime(repoRoot);
  mutateTaskStore(repoRoot, (store) => {
    const row = store.tasks.find((t) => t.id === taskId);
    if (row) delete row.mergeDeferredReason;
    return store;
  });
  mgr.completeMerge(taskId);
  appendMetric(repoRoot, {
    id: taskId,
    agent: task.agent || 'desconocido',
    model: task.model,
    mergeBroke: false,
    verify: true,
    firstPass: task.card?.verifyOk !== false,
    durationMs: null,
    turns: null,
    sources: { mergeBroke: 'cola_mezcla' },
  });
  return { merged: true, commit: newTip };
}

export async function drainMergeQueue(repoRoot, opts = {}) {
  assertFencing(repoRoot, opts.fencingToken);
  const queue = listMergeQueue(repoRoot);
  if (!queue.length) return { processed: 0 };
  const head = queue[0];
  const result = await mergeOneTask(repoRoot, head.id, opts);
  return { processed: 1, ...result };
}