// Calidad por tarea con la misma vara en los dos caminos (TB-03). La base son los campos de
// src/silka/metrics (buildTaskMetric); repairs y outOfScope los aporta la corrida del benchmark.
import { buildTaskMetric } from '../../src/silka/metrics/record.mjs';
import { SIN_DATO } from '../../src/silka/metrics/fields.mjs';

export const QUALITY_FIELDS = ['verify', 'firstPass', 'repairs', 'mergeBroke', 'outOfScope'];

function bool(v) {
  if (v === true || v === 'pass') return true;
  if (v === false || v === 'fail') return false;
  return null;
}

function count(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Registra una tarea con buildTaskMetric y devuelve la calidad con exactamente QUALITY_FIELDS,
 * igual para ambos caminos. Un dato que falta queda en null (sin dato), nunca en 0.
 */
export function buildQualityRecord({ id, agent, model = null, verify, firstPass, mergeBroke, repairs, outOfScope }) {
  const metric = buildTaskMetric({ id, agent, model, verify: bool(verify), firstPass: bool(firstPass), mergeBroke: bool(mergeBroke) });
  const quality = {
    verify: bool(metric.verify),
    firstPass: bool(metric.firstPass),
    repairs: count(repairs),
    mergeBroke: bool(metric.mergeBroke),
    outOfScope: count(outOfScope),
  };
  const sources = {
    verify: metric.sources.verify,
    firstPass: metric.sources.firstPass,
    mergeBroke: metric.sources.mergeBroke,
    repairs: quality.repairs == null ? SIN_DATO : 'benchmark:reparaciones',
    outOfScope: quality.outOfScope == null ? SIN_DATO : 'benchmark:git-diff',
  };
  return { quality, sources };
}

/** Archivos cambiados fuera del alcance permitido por la tarea (prefijos de ruta). */
export function outOfScopeCount(changedFiles, allowedPrefixes) {
  const allowed = allowedPrefixes.map((p) => p.replace(/\\/g, '/'));
  return changedFiles
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !allowed.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`)))
    .length;
}
