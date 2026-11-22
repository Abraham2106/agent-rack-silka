// Formato de un punto del diagnóstico de `silka doctor` (solo lectura).
// Cada punto: id estable, nombre, estado (ok | aviso | falla), causa y arreglo sugerido.
// El formato es contrato: `silka doctor --json` lo devuelve tal cual al manager.

export const STATUS = Object.freeze({ OK: 'ok', WARN: 'aviso', FAIL: 'falla' });

const STATUSES = new Set(Object.values(STATUS));

/** Construye un punto con los campos en orden fijo. Lanza si el estado no es válido. */
export function point({ id, name, status, cause = '', fix = '' }) {
  if (!id || !name) throw new Error('doctor: cada punto necesita id y nombre');
  if (!STATUSES.has(status)) throw new Error(`doctor: estado no válido para ${id}: ${status}`);
  return { id: String(id), name: String(name), status, cause: String(cause), fix: String(fix) };
}

/** Resumen: si hay alguna falla, el código de salida es 1. Los avisos no fallan. */
export function summarize(points) {
  const failed = points.filter((p) => p.status === STATUS.FAIL).length;
  const warned = points.filter((p) => p.status === STATUS.WARN).length;
  return { ok: failed === 0, failed, warned, exitCode: failed > 0 ? 1 : 0 };
}

/** Salida JSON estable: { ok, failed, warned, points: [{ id, name, status, cause, fix }] }. */
export function toJson(points) {
  const s = summarize(points);
  return JSON.stringify({
    ok: s.ok,
    failed: s.failed,
    warned: s.warned,
    points: points.map((p) => ({ id: p.id, name: p.name, status: p.status, cause: p.cause, fix: p.fix })),
  }, null, 2);
}

const ICON = { [STATUS.OK]: 'OK   ', [STATUS.WARN]: 'AVISO', [STATUS.FAIL]: 'FALLA' };

/** Texto para la terminal: una línea por punto y, si no está bien, causa y arreglo debajo. */
export function toText(points) {
  const lines = [];
  for (const p of points) {
    lines.push(`${ICON[p.status]} ${p.name}`);
    if (p.status !== STATUS.OK) {
      if (p.cause) lines.push(`        causa: ${p.cause}`);
      if (p.fix) lines.push(`        arreglo: ${p.fix}`);
    }
  }
  const s = summarize(points);
  lines.push('');
  lines.push(s.ok
    ? `Todo bien${s.warned ? ` (${s.warned} aviso${s.warned === 1 ? '' : 's'})` : ''}.`
    : `${s.failed} falla${s.failed === 1 ? '' : 's'}${s.warned ? ` y ${s.warned} aviso${s.warned === 1 ? '' : 's'}` : ''}. Revisa los arreglos de arriba.`);
  return lines.join('\n');
}
