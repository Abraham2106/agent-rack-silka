import { silkaError } from '../codemode/errors.mjs';

/** Agrupa ids de tarea por oleada: manual `waves` o niveles por dependsOn. */
export function computeWaves(taskSpecs, manualWaves) {
  const ids = taskSpecs.map((t) => t.id || t.title);
  const byId = new Map(taskSpecs.map((t, i) => [t.id || ids[i], t]));

  if (manualWaves?.length) {
    const used = new Set();
    const waves = [];
    for (const row of manualWaves) {
      const waveIds = row.map(String).filter(Boolean);
      for (const id of waveIds) {
        if (!byId.has(id)) {
          throw silkaError('E_TASK_INVALID', `waves: tarea desconocida ${id}`);
        }
        used.add(id);
      }
      waves.push(waveIds);
    }
    const missing = ids.filter((id) => !used.has(id));
    if (missing.length) {
      throw silkaError('E_TASK_INVALID', `waves: faltan tareas en el plan: ${missing.join(', ')}`);
    }
    return waves;
  }

  const depth = new Map();
  const visiting = new Set();

  function depDepth(id) {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) {
      throw silkaError('E_TASK_INVALID', `Ciclo de dependsOn en ${id}`);
    }
    visiting.add(id);
    const spec = byId.get(id);
    const deps = (spec?.dependsOn || []).map(String);
    let d = 0;
    for (const dep of deps) {
      if (!byId.has(dep)) {
        throw silkaError('E_TASK_INVALID', `dependsOn desconocido: ${dep}`);
      }
      d = Math.max(d, depDepth(dep) + 1);
    }
    visiting.delete(id);
    depth.set(id, d);
    return d;
  }

  for (const id of ids) depDepth(id);
  const max = Math.max(0, ...depth.values());
  const waves = [];
  for (let w = 0; w <= max; w += 1) {
    waves.push(ids.filter((id) => depth.get(id) === w));
  }
  return waves.filter((row) => row.length);
}