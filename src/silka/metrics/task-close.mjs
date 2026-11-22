import { appendMetric } from './record.mjs';
import { getTask } from '../tasks/store.mjs';
import { STATES } from '../tasks/states.mjs';

function countAgentTurns(task) {
  return (task.transitions || []).filter((t) => t.cause === 'fin_turno_agente').length;
}

function taskDurationMs(task) {
  if (!task?.createdAt) return { durationMs: null };
  const ms = Date.now() - Date.parse(task.createdAt);
  if (!Number.isFinite(ms) || ms < 0) return { durationMs: null };
  return { durationMs: ms, sources: { durationMs: 'silka:timer' } };
}

/** Métrica al cerrar la entrega (LISTA o verificacion_fallida). FR-ME-01/02. */
export function buildDeliveryMetricInput(task) {
  const verifyOk = task.card?.verify?.ok ?? null;
  const repairs = Number(task.repairCount) || 0;
  const turns = countAgentTurns(task);
  const { durationMs, sources: durationSources } = taskDurationMs(task);
  const sources = { ...(durationSources || {}) };

  if (turns > 0) sources.turns = 'silka:transiciones';
  if (verifyOk != null) sources.verify = 'task:card';
  if (verifyOk != null) {
    sources.firstPass = 'silka:reparaciones';
  }

  let firstPass = null;
  if (verifyOk === true && repairs === 0) firstPass = true;
  else if (verifyOk === false || repairs > 0) firstPass = false;

  return {
    id: task.id,
    agent: task.agent || 'desconocido',
    model: task.model ?? null,
    verify: verifyOk,
    firstPass,
    mergeBroke: null,
    turns: turns || null,
    durationMs,
    interrupts: task.interrupts ?? null,
    usage: task.agentUsage || task.lastUsage,
    sources,
  };
}

export function recordDeliveryMetric(workspace, task) {
  if (!task?.id) return null;
  return appendMetric(workspace, buildDeliveryMetricInput(task));
}

export function recordDeliveryMetricIfClosed(workspace, taskId) {
  const task = getTask(workspace, taskId);
  if (!task) return null;
  if (task.state !== STATES.LISTA && task.state !== STATES.VERIFICACION_FALLIDA) return null;
  return recordDeliveryMetric(workspace, task);
}

/** Métrica al terminar un intento de mezcla en cola. */
export function recordMergeMetric(workspace, task, { mergeBroke, verify } = {}) {
  if (!task?.id) return null;
  const repairs = Number(task.repairCount) || 0;
  const cardOk = task.card?.verify?.ok;
  const sources = { mergeBroke: 'cola_mezcla' };
  if (verify != null) sources.verify = 'cola_mezcla:verify';
  else if (cardOk != null) sources.verify = 'task:card';
  if (cardOk != null || verify != null) sources.firstPass = 'silka:reparaciones';

  let firstPass = null;
  const ok = verify ?? cardOk;
  if (ok === true && repairs === 0) firstPass = true;
  else if (ok === false || repairs > 0) firstPass = false;

  return appendMetric(workspace, {
    id: task.id,
    agent: task.agent || 'desconocido',
    model: task.model ?? null,
    mergeBroke: mergeBroke ?? null,
    verify: verify ?? cardOk ?? null,
    firstPass,
    usage: task.agentUsage || task.lastUsage,
    sources,
  });
}

export function recordMergeMetricForTask(workspace, taskId, outcome) {
  const task = getTask(workspace, taskId);
  if (!task) return null;
  return recordMergeMetric(workspace, task, outcome);
}