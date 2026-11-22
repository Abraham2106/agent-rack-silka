export const METRIC_FIELDS = [
  'tokensIn',
  'tokensOut',
  'tokensCache',
  'turns',
  'durationMs',
  'verify',
  'firstPass',
  'mergeBroke',
  'interrupts',
];

export const SIN_DATO = 'sin dato';

/** Marca cada campo con su fuente (ADR-0010). */
export function withSources(values = {}, sources = {}) {
  const row = { sources: {} };
  for (const key of METRIC_FIELDS) {
    const src = sources[key] || (values[key] == null ? SIN_DATO : 'desconocida');
    row[key] = values[key] ?? null;
    row.sources[key] = src;
  }
  return row;
}