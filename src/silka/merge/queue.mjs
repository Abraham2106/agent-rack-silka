import { createTaskManager } from '../tasks/manager.mjs';
import { STATES } from '../tasks/states.mjs';
import { readMergeRuntime } from './state.mjs';

function enqueueAt(task) {
  const tr = (task.transitions || []).filter((t) => t.to === STATES.COLA_MEZCLA);
  if (tr.length) return tr[tr.length - 1].at;
  return task.mergeEnqueuedAt || task.createdAt || '';
}

export function listMergeQueue(repoRoot) {
  const mgr = createTaskManager(repoRoot);
  const queued = mgr
    .list()
    .filter((t) => t.state === STATES.COLA_MEZCLA)
    .sort((a, b) => String(enqueueAt(a)).localeCompare(String(enqueueAt(b))));
  const runtime = readMergeRuntime(repoRoot);
  return queued.map((task, index) => ({
    id: task.id,
    title: task.title,
    position: index + 1,
    enqueuedAt: enqueueAt(task),
    step: runtime?.taskId === task.id ? runtime.step : null,
    version: task.version,
  }));
}

export function mergeTaskStatus(repoRoot, taskId) {
  const mgr = createTaskManager(repoRoot);
  const task = mgr.list().find((t) => t.id === taskId);
  if (!task) return null;
  const queue = listMergeQueue(repoRoot);
  const row = queue.find((q) => q.id === taskId);
  const runtime = readMergeRuntime(repoRoot);
  return {
    id: task.id,
    state: task.state,
    position: row?.position ?? null,
    step: runtime?.taskId === taskId ? runtime.step : row?.step ?? null,
    enqueuedAt: row?.enqueuedAt ?? enqueueAt(task),
    mergeFailure: task.mergeFailure || null,
    builderDeferred: Boolean(task.mergeDeferredReason),
    deferredReason: task.mergeDeferredReason || null,
  };
}