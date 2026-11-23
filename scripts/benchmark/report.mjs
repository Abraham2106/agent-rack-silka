// Informe Markdown del benchmark (TB-04, TB-05). Solo usa datos ya medidos: no llama a proveedores.
import fs from 'node:fs';
import path from 'node:path';

export const GOAL_SAVINGS = 0.7;
export const LIMITS = [
  'Cuenta solo los tokens del manager (entrada, salida y caché). Los tokens internos de cada agente delegado quedan fuera.',
  'Cada camino corre una vez por tarea: la varianza entre corridas no está medida.',
  'Son tareas pequeñas y acotadas del propio repo; no representan todo el trabajo de un proyecto.',
  'La calidad usa el verify de cada tarea como única vara de éxito; un verify débil sobreestima la calidad.',
  'El costo viene del reporte del proveedor cuando lo trae; si falta, la celda dice "sin dato".',
];

const SIN_DATO = 'sin dato';

function sumOrNull(values) {
  if (values.some((v) => v == null)) return null;
  return values.reduce((a, b) => a + b, 0);
}

function rateOrNull(values) {
  if (values.some((v) => v == null) || values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}

/** Totales de un camino a partir de sus resultados por tarea. Un dato faltante vuelve el total null. */
export function aggregatePath(results) {
  const u = results.map((r) => r.usage);
  const q = results.map((r) => r.quality);
  return {
    tasks: results.length,
    tokensIn: sumOrNull(u.map((x) => x.tokensIn)),
    tokensOut: sumOrNull(u.map((x) => x.tokensOut)),
    tokensCache: sumOrNull(u.map((x) => x.tokensCache)),
    costUsd: sumOrNull(u.map((x) => x.costUsd)),
    verifyRate: rateOrNull(q.map((x) => x.verify)),
    firstPassRate: rateOrNull(q.map((x) => x.firstPass)),
    repairs: sumOrNull(q.map((x) => x.repairs)),
    mergeBroke: sumOrNull(q.map((x) => (x.mergeBroke == null ? null : x.mergeBroke ? 1 : 0))),
    outOfScope: sumOrNull(q.map((x) => x.outOfScope)),
  };
}

/**
 * Compara los dos caminos. El ahorro solo existe si ambos tienen tokensIn. La calidad se compara
 * dimensión a dimensión: el ahorro con peor calidad se reporta como tal, nunca como mejora neta.
 */
export function evaluate(solo, silka) {
  const savings = solo.tokensIn && silka.tokensIn != null ? 1 - silka.tokensIn / solo.tokensIn : null;
  const pairs = [
    [silka.verifyRate, solo.verifyRate, 'up'],
    [silka.firstPassRate, solo.firstPassRate, 'up'],
    [silka.repairs, solo.repairs, 'down'],
    [silka.mergeBroke, solo.mergeBroke, 'down'],
    [silka.outOfScope, solo.outOfScope, 'down'],
  ];
  const known = pairs.every(([a, b]) => a != null && b != null);
  const worse = pairs.some(([a, b, dir]) => a != null && b != null && (dir === 'up' ? a < b : a > b));
  const qualityEqualOrBetter = known ? !worse : null;

  let verdict;
  if (savings == null) verdict = SIN_DATO;
  else if (savings >= GOAL_SAVINGS && qualityEqualOrBetter === true) verdict = 'cumple';
  else verdict = 'no cumple';

  let note = '';
  if (savings != null && savings > 0 && worse) note = 'Ahorro con peor calidad: no es mejora neta.';
  else if (savings != null && savings >= GOAL_SAVINGS && qualityEqualOrBetter !== true) {
    note = 'El ahorro supera el 70%, pero la calidad no es igual o mejor (o falta un dato).';
  }
  return { savings, qualityEqualOrBetter, verdict, note };
}

const pct = (x) => (x == null ? SIN_DATO : `${(x * 100).toFixed(1)}%`);
const num = (x) => (x == null ? SIN_DATO : String(x));
const money = (x) => (x == null ? SIN_DATO : `$${x.toFixed(4)}`);

/**
 * @param {object} p
 * @param {string} p.date        fecha de la corrida (YYYY-MM-DD)
 * @param {string} p.commit      commit del que partieron ambos caminos
 * @param {object} p.models      { solo, silka } modelos usados
 * @param {object[]} p.solo      resultados por tarea del camino solo
 * @param {object[]} p.silka     resultados por tarea del camino con Silka
 * @param {string[]} [p.limits]  límites de la medición (por defecto LIMITS)
 */
export function buildReport({ date, commit, tasksHash, models, solo, silka, limits = LIMITS }) {
  const a = aggregatePath(solo);
  const b = aggregatePath(silka);
  const e = evaluate(a, b);
  const row = (label, f) => `| ${label} | ${f(a)} | ${f(b)} |`;
  const lines = [
    `# Benchmark de tokens del manager: ${date}`,
    '',
    `- Commit de partida (ambos caminos): \`${commit}\``,
    `- Archivo de tareas (sha256): \`${tasksHash ?? SIN_DATO}\``,
    `- Modelo camino solo: ${models?.solo ?? SIN_DATO}`,
    `- Modelo camino con Silka: ${models?.silka ?? SIN_DATO}`,
    `- Tareas: ${a.tasks} (camino solo) y ${b.tasks} (camino con Silka)`,
    '',
    '## Tabla comparativa',
    '',
    '| Medida | Solo | Con Silka |',
    '| --- | ---: | ---: |',
    row('Tokens de entrada del manager', (x) => num(x.tokensIn)),
    row('Tokens de salida del manager', (x) => num(x.tokensOut)),
    row('Tokens de caché leídos', (x) => num(x.tokensCache)),
    row('Costo (USD, reportado)', (x) => money(x.costUsd)),
    row('Verify a la primera (tasa)', (x) => pct(x.verifyRate)),
    row('Éxito a la primera (tasa)', (x) => pct(x.firstPassRate)),
    row('Reparaciones', (x) => num(x.repairs)),
    row('Roturas al mezclar', (x) => num(x.mergeBroke)),
    row('Archivos fuera de alcance', (x) => num(x.outOfScope)),
    '',
    '## Ahorro y meta',
    '',
    `- Ahorro de tokens de entrada: ${e.savings == null ? 'sin dato (no se calcula)' : pct(e.savings)}`,
    `- Calidad igual o mejor con Silka: ${e.qualityEqualOrBetter == null ? SIN_DATO : e.qualityEqualOrBetter ? 'sí' : 'no'}`,
    `- Meta v1 (NFR-TOK-01, al menos 70% menos con calidad igual o mejor): **${e.verdict}**`,
  ];
  if (e.note) lines.push(`- ${e.note}`);
  lines.push('', '## Límites de la medición', '', ...limits.map((l) => `- ${l}`), '');
  return lines.join('\n');
}

/**
 * Guarda el informe en docs/benchmarks/<fecha>.md y devuelve la ruta. Si ese archivo ya existe
 * (otra corrida del mismo día), usa <fecha>-2.md, -3.md...: nunca sobrescribe un informe anterior.
 */
export function writeReport(dir, date, markdown) {
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${date}.md`);
  for (let n = 2; fs.existsSync(file); n += 1) file = path.join(dir, `${date}-${n}.md`);
  fs.writeFileSync(file, markdown, 'utf8');
  return file;
}
