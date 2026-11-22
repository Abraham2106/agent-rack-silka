#!/usr/bin/env node
// Corre las mismas tareas por dos caminos desde el mismo commit y escribe el informe (TB-01).
//   node scripts/benchmark/run.mjs --help
//   node scripts/benchmark/run.mjs --confirmar-gasto     (consume cuota real del proveedor)
// Sin --confirmar-gasto solo imprime el plan y no llama a ningún proveedor.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managerUsageFromClaudeJson, opencodeUsageFromJsonl } from './usage.mjs';
import { buildQualityRecord, outOfScopeCount } from './quality.mjs';
import { LIMITS, buildReport, writeReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
export const TASKS_FILE = path.join(here, 'tasks.json');
export const REPORTS_DIR = path.join(repoRoot, 'docs', 'benchmarks');
export const SILKA_HINT =
  'Para esta tarea delega el trabajo de código con la API de Silka (silka_execute) en vez de editar archivos tú mismo. ' +
  'Resume el resultado en una línea.';

/** Instrucción del camino con Silka cuando el manager es OpenCode: usa silka_execute (MCP agent-rack). */
export function opencodeSilkaHint(workspace, model) {
  return (
    `Para esta tarea NO edites archivos tú mismo: delega con la herramienta silka_execute (servidor MCP agent-rack). ` +
    `Lee src/silka/codemode/silka.d.ts para la API. En el código llama a silka.launch({ title, scope, verify, agent: 'opencode', ` +
    `model: '${model}', prompt, workspace: '${workspace}' }) y luego silka.waitAll([...]). Resume el resultado en una línea.`
  );
}

/** Límites extra del informe que dependen de la corrida (no del código): Silka realmente usado, o no. */
export function silkaCallsLimit(silkaResults) {
  const counted = silkaResults.filter((r) => r.silkaCalls != null);
  if (counted.length === 0) return [];
  const without = counted.filter((r) => r.silkaCalls === 0).length;
  if (without === 0) return [];
  return [
    `${without} de ${counted.length} tareas del camino con Silka no llamaron a silka_execute: esas cifras no son de un camino delegado con Silka.`,
  ];
}

const USAGE = `Uso: node scripts/benchmark/run.mjs [--confirmar-gasto] [--proveedor claude|opencode] [--modelo-solo m] [--modelo-silka m]

Corre las tareas de scripts/benchmark/tasks.json por el camino solo y por el camino con Silka,
desde el commit actual (el árbol debe estar limpio) y escribe docs/benchmarks/<fecha>.md.
--proveedor opencode usa \`opencode run --format json\` (modelos en formato proveedor/modelo).
Sin --confirmar-gasto no llama a ningún proveedor: solo muestra el plan.`;

/** Carga y valida el conjunto fijo de tareas. Devuelve también su hash para el informe. */
export function loadTasks(file = TASKS_FILE) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (tasks.length < 3) throw new Error(`El benchmark exige N >= 3 tareas; hay ${tasks.length}.`);
  for (const t of tasks) {
    if (!t.id || !t.verify || !Array.isArray(t.permitidos)) throw new Error(`Tarea incompleta: ${t.id || '(sin id)'}`);
  }
  return { tasks, hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

/**
 * Corre una tarea por un camino. `runner` devuelve la salida del manager y el resultado del verify.
 * Las cifras de calidad que el runner no pueda medir quedan en null (sin dato).
 */
async function runOne({ path: pathName, task, commit, runner, workdirFor, model }) {
  const { dir, cleanup } = await workdirFor(pathName, commit, task);
  try {
    const out = await runner(task, { workdir: dir, commit, path: pathName });
    // Cada runner puede traer su propio uso (OpenCode); si no, se lee el JSON de `claude -p`.
    const usage = out.usage ?? managerUsageFromClaudeJson(out.stdout);
    const outOfScope = out.changedFiles ? outOfScopeCount(out.changedFiles, task.permitidos) : null;
    const { quality, sources } = buildQualityRecord({
      id: task.id,
      agent: pathName === 'solo' ? 'manager-solo' : 'manager-silka',
      model,
      verify: out.verify,
      firstPass: out.firstPass,
      mergeBroke: out.mergeBroke,
      repairs: out.repairs,
      outOfScope,
    });
    return { taskId: task.id, usage, quality, sources, silkaCalls: out.silkaCalls ?? null };
  } finally {
    await cleanup();
  }
}

/**
 * Corre todas las tareas por ambos caminos. Ambos parten del mismo `commit` y del mismo archivo de tareas.
 * @param {object} p
 * @param {string} p.commit
 * @param {object[]} p.tasks
 * @param {string} p.tasksHash
 * @param {{solo: Function, silka: Function}} p.runners  (task, {workdir, commit, path}) => {stdout, verify, firstPass, mergeBroke, repairs, changedFiles}
 * @param {Function} p.workdirFor  (path, commit, task) => {dir, cleanup}
 * @param {{solo?: string, silka?: string}} [p.models]
 * @param {Date} [p.now]
 * @param {string[]} [p.extraLimits] límites propios de la corrida (p. ej. proveedor sin aislar)
 */
export async function runBenchmark({ commit, tasks, tasksHash, runners, workdirFor, models = {}, now = new Date(), extraLimits = [] }) {
  if (!commit) throw new Error('Falta el commit de partida.');
  const date = now.toISOString().slice(0, 10);
  const solo = [];
  const silka = [];
  for (const task of tasks) {
    solo.push(await runOne({ path: 'solo', task, commit, runner: runners.solo, workdirFor, model: models.solo }));
    silka.push(await runOne({ path: 'silka', task, commit, runner: runners.silka, workdirFor, model: models.silka }));
  }
  const limits = [...LIMITS, ...extraLimits, ...silkaCallsLimit(silka)];
  const markdown = buildReport({ date, commit, tasksHash, models: { solo: models.solo, silka: models.silka }, solo, silka, limits });
  return { date, commit, solo, silka, markdown };
}

/** Worktree temporal, detached en el commit, para que cada corrida parta del mismo código. */
export function gitWorkdir(repo = repoRoot) {
  return async (pathName, commit, task) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `silka-bench-${pathName}-${task.id}-`));
    const add = spawnSync('git', ['worktree', 'add', '--detach', dir, commit], { cwd: repo, encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`No se pudo crear el worktree: ${add.stderr}`);
    const cleanup = async () => {
      spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, encoding: 'utf8' });
    };
    return { dir, cleanup };
  };
}

/** Runner real: `claude -p` con salida JSON (uso reportado por el proveedor). */
export function claudeRunner({ model, silka = false } = {}) {
  return async (task, { workdir, commit }) => {
    const prompt = `${task.title}.\nAlcance: ${task.alcance}\nEntregable: ${task.entregable}`;
    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);
    if (silka) args.push('--append-system-prompt', SILKA_HINT);
    const run = spawnSync('claude', args, { cwd: workdir, input: prompt, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
    const check = spawnSync(task.verify, { cwd: workdir, encoding: 'utf8', shell: true });
    const diff = spawnSync('git', ['diff', '--name-only', commit], { cwd: workdir, encoding: 'utf8' });
    const changedFiles = diff.status === 0 ? diff.stdout.split(/\r?\n/).filter(Boolean) : null;
    // La calidad de reparaciones y de roturas al mezclar aún no se registra en este runner: queda en sin dato.
    return { stdout: run.stdout || '', verify: check.status === 0, firstPass: null, repairs: null, mergeBroke: null, changedFiles };
  };
}

/** Cuenta las llamadas distintas a silka_execute en el flujo de `opencode run --format json`. */
export function countSilkaCalls(stdout) {
  const ids = new Set();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{') || !line.includes('silka_execute')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'tool_use' && /silka_execute/.test(JSON.stringify(event.part ?? {}))) {
        ids.add(event.part?.id ?? ids.size);
      }
    } catch {
      // línea que no es JSON: no cuenta
    }
  }
  return ids.size;
}

/**
 * Runner de OpenCode: `opencode run --format json` con el modelo dado. El uso sale de los eventos
 * step_finish del proveedor (opencodeUsageFromJsonl); nunca se estima. En el camino con Silka se
 * cuentan las llamadas a silka_execute: si son cero, esa corrida no usó Silka.
 */
export function opencodeRunner({ model, silka = false } = {}) {
  return async (task, { workdir, commit }) => {
    const base = `${task.title}. Alcance: ${task.alcance} Entregable: ${task.entregable}`;
    const prompt = silka ? `${base} ${opencodeSilkaHint(workdir, model)}` : base;
    // Una sola línea y comillas escapadas: el prompt viaja como argumento de la shell.
    const line = prompt.replace(/\s+/g, ' ').replace(/"/g, '\\"');
    const cmd = `opencode run --format json --auto --standalone --title "bench-${task.id}-${silka ? 'silka' : 'solo'}" -m ${model} "${line}"`;
    const run = spawnSync(cmd, { cwd: workdir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
    const check = spawnSync(task.verify, { cwd: workdir, encoding: 'utf8', shell: true });
    const diff = spawnSync('git', ['diff', '--name-only', commit], { cwd: workdir, encoding: 'utf8' });
    const changedFiles = diff.status === 0 ? diff.stdout.split(/\r?\n/).filter(Boolean) : null;
    const stdout = run.stdout || '';
    return {
      stdout,
      usage: opencodeUsageFromJsonl(stdout),
      silkaCalls: silka ? countSilkaCalls(stdout) : 0,
      verify: check.status === 0,
      firstPass: null,
      repairs: null,
      mergeBroke: null,
      changedFiles,
    };
  };
}

function gitClean(cwd) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === '';
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const { tasks, hash } = loadTasks();
  const models = { solo: arg('--modelo-solo'), silka: arg('--modelo-silka') };
  const proveedor = arg('--proveedor') ?? 'claude';
  if (proveedor !== 'claude' && proveedor !== 'opencode') {
    console.error(`--proveedor debe ser claude u opencode; llegó "${proveedor}".`);
    return 1;
  }
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  if (!process.argv.includes('--confirmar-gasto')) {
    console.log(`Plan: ${tasks.length} tareas x 2 caminos desde ${commit.slice(0, 12)} (tareas ${hash.slice(0, 12)}).`);
    console.log(`Proveedor: ${proveedor}. Esto consume cuota real del proveedor. Repite con --confirmar-gasto para correrlo.`);
    return 2;
  }
  if (proveedor === 'opencode' && (!models.solo || !models.silka)) {
    console.error('Con --proveedor opencode hay que fijar --modelo-solo y --modelo-silka (proveedor/modelo).');
    return 1;
  }
  if (!gitClean(repoRoot)) {
    console.error('El árbol de trabajo no está limpio: el benchmark debe partir de un commit.');
    return 1;
  }
  // Solo OpenCode: el camino solo no puede aislarse del MCP agent-rack (config global), así que se declara.
  const extraLimits =
    proveedor === 'opencode'
      ? ['Con OpenCode, el camino solo corre con el MCP agent-rack de la config global de OpenCode conectado: sus definiciones de herramientas entran en el contexto de ambos caminos. No se aisló porque eso exige cambiar la config del usuario.']
      : [];
  const runners =
    proveedor === 'opencode'
      ? { solo: opencodeRunner({ model: models.solo }), silka: opencodeRunner({ model: models.silka, silka: true }) }
      : { solo: claudeRunner({ model: models.solo }), silka: claudeRunner({ model: models.silka, silka: true }) };
  const result = await runBenchmark({
    commit,
    tasks,
    tasksHash: hash,
    models,
    runners,
    workdirFor: gitWorkdir(),
    extraLimits,
  });
  const file = writeReport(REPORTS_DIR, result.date, result.markdown);
  console.log(`Informe: ${file}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 1; });
}
