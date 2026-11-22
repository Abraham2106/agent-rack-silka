// Diff por líneas (LCS) para mostrar qué cambiaría `silka setup`. Los archivos son pequeños
// (config de agent-rack, entrada del bridge), así que el coste cuadrático es aceptable.

/** Líneas con prefijo: "  " igual, "- " se quita, "+ " se añade. Vacío si son idénticos. */
export function lineDiff(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  if (a.join('\n') === b.join('\n')) return [];
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(`  ${a[i]}`); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push(`- ${a[i]}`); i += 1; }
    else { out.push(`+ ${b[j]}`); j += 1; }
  }
  while (i < n) { out.push(`- ${a[i]}`); i += 1; }
  while (j < m) { out.push(`+ ${b[j]}`); j += 1; }
  return out;
}
