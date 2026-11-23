#!/usr/bin/env node
// Corre las mismas tareas por dos caminos desde el mismo commit y escribe el informe (TB-01).
//   node scripts/benchmark/run.mjs --help
//   node scripts/benchmark/run.mjs --confirmar-gasto     (consume cuota real del proveedor)
// Sin --confirmar-gasto solo imprime el plan y no llama a ningún proveedor.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managerUsageFromClaudeJson, opencodeUsageFromJsonl } from './usage.mjs';
import { buildQualityRecord, outOfScopeCount } from './quality.mjs';
import { LIMITS, buildReport, writeReport } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
export const TASKS_FILE = path.join(here, 'tasks.json');
export const REPORTS_DIR = path.join(repoRoot, 'docs', 'benchmarks');
export const BENCH_PREFIX = 'silka-bench-';
export const OPENCODE_TIMEOUT_MS = 15 * 60 * 1000;
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

/** Límites de una corrida por tareas inválidas (el repo principal se tocó) o con tope de tiempo alcanzado. */
export function runLimits(results) {
  const out = [];
  const invalid = results.filter((r) => r.invalid);
  if (invalid.length > 0) {
    const list = invalid.map((r) => `${r.taskId} (${r.path}): ${r.invalid}`).join('; ');
    out.push(`Tareas inválidas, sin calidad medida: ${list}. Sus tokens sí se gastaron y están contados.`);
  }
  const timed = results.filter((r) => r.timedOut);
  if (timed.length > 0) {
    out.push(`${timed.length} corridas llegaron al tope de ${OPENCODE_TIMEOUT_MS / 60000} minutos y se cerraron: su uso puede ser parcial.`);
  }
  return out;
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

// ---------------------------------------------------------------------------
// Procesos: cada comando se corre con su PID de Node y su árbol se cierra con taskkill /T.
// ---------------------------------------------------------------------------

/** Argumentos de taskkill para cerrar el árbol de un PID de Windows (nunca se usa ps). */
export function killTreeArgs(pid) {
  return ['/PID', String(pid), '/T', '/F'];
}

export function killProcessTree(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    return spawnSync('taskkill', killTreeArgs(pid), { encoding: 'utf8', windowsHide: true }).status === 0;
  }
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** Corre un comando de shell y devuelve su salida. Si vence el tiempo, cierra el árbol de su PID. */
export function runProcess(cmd, { cwd, env, timeoutMs = OPENCODE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, env, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

/** Cuenta los procesos opencode.exe del sistema (solo para registrar si quedó alguno al terminar). */
export function countOpencodeProcesses() {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq opencode.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter((l) => /opencode\.exe/i.test(l)).length;
}

// ---------------------------------------------------------------------------
// Repo principal: el agente no debe tocarlo. Si lo toca, la tarea es inválida.
// ---------------------------------------------------------------------------

function gitOut(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** true si el árbol del repo tiene cambios (tracked o sin rastrear, sin contar ignorados). */
export function repoTouched(repo) {
  const status = gitOut(['status', '--porcelain'], repo);
  return status == null ? true : status.trim() !== '';
}

/**
 * Guarda los cambios del repo en un parche y lo deja limpio (HEAD). Solo se usa cuando la tarea es
 * inválida: el repo estaba limpio al empezar (gitClean), así que lo único que se quita es lo que el agente escribió.
 */
export function restoreRepo(repo, patchFile) {
  const diff = gitOut(['diff', 'HEAD', '--binary'], repo) ?? '';
  const untracked = gitOut(['ls-files', '--others', '--exclude-standard'], repo) ?? '';
  fs.writeFileSync(patchFile, `${diff}\n# sin rastrear:\n${untracked}`, 'utf8');
  spawnSync('git', ['reset', '--hard', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  spawnSync('git', ['clean', '-fd'], { cwd: repo, encoding: 'utf8' });
  return patchFile;
}

// ---------------------------------------------------------------------------
// Corrida por tarea y camino.
// ---------------------------------------------------------------------------

/**
 * Corre una tarea por un camino. `runner` devuelve la salida del manager y el resultado del verify.
 * Si tras correr el agente el repo principal quedó con cambios, la tarea se marca inválida:
 * se guarda el parche, se restaura el repo y no cuenta calidad (los tokens gastados sí cuentan).
 */
async function runOne({ path: pathName, task, commit, runner, workdirFor, model, repo }) {
  const { dir, cleanup } = await workdirFor(pathName, commit, task);
  try {
    const out = await runner(task, { workdir: dir, commit, path: pathName });
    // Cada runner puede traer su propio uso (OpenCode); si no, se lee el JSON de `claude -p`.
    const usage = out.usage ?? managerUsageFromClaudeJson(out.stdout);
    const base = { taskId: task.id, path: pathName, usage, silkaCalls: out.silkaCalls ?? null, timedOut: Boolean(out.timedOut) };
    if (repo && repoTouched(repo)) {
      const patch = path.join(os.tmpdir(), `bench-invalida-${pathName}-${task.id}-${Date.now()}.patch`);
      restoreRepo(repo, patch);
      const { quality, sources } = buildQualityRecord({ id: task.id, agent: pathName === 'solo' ? 'manager-solo' : 'manager-silka', model });
      return { ...base, invalid: `el repo principal quedó con cambios (parche guardado en ${patch})`, quality, sources };
    }
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
    return { ...base, quality, sources };
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
 * @param {string} [p.repo] repo principal que el agente no debe tocar (guarda de tareas inválidas)
 */
export async function runBenchmark({ commit, tasks, tasksHash, runners, workdirFor, models = {}, now = new Date(), extraLimits = [], repo }) {
  if (!commit) throw new Error('Falta el commit de partida.');
  const date = now.toISOString().slice(0, 10);
  const solo = [];
  const silka = [];
  for (const task of tasks) {
    solo.push(await runOne({ path: 'solo', task, commit, runner: runners.solo, workdirFor, model: models.solo, repo }));
    silka.push(await runOne({ path: 'silka', task, commit, runner: runners.silka, workdirFor, model: models.silka, repo }));
  }
  const limits = [...LIMITS, ...extraLimits, ...silkaCallsLimit(silka), ...runLimits([...solo, ...silka])];
  const markdown = buildReport({ date, commit, tasksHash, models: { solo: models.solo, silka: models.silka }, solo, silka, limits });
  return { date, commit, solo, silka, markdown };
}

/** Carpeta base de las worktrees de la corrida: dentro de allowedWorkspaces, nunca en %TEMP% (ver docs del informe). */
export function benchBaseDir(repo = repoRoot) {
  return path.dirname(repo);
}

/** Worktree temporal, detached en el commit, para que cada corrida parta del mismo código. */
export function gitWorkdir(repo = repoRoot) {
  return async (pathName, commit, task) => {
    const dir = fs.mkdtempSync(path.join(benchBaseDir(repo), `${BENCH_PREFIX}${pathName}-${task.id}-`));
    const add = spawnSync('git', ['worktree', 'add', '--detach', dir, commit], { cwd: repo, encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`No se pudo crear el worktree: ${add.stderr}`);
    const cleanup = async () => {
      removeWorktree(repo, dir);
    };
    return { dir, cleanup };
  };
}

/** Quita una worktree de la corrida y su carpeta. Solo borra rutas con el prefijo de la corrida. */
export function removeWorktree(repo, dir) {
  if (path.basename(dir).startsWith(BENCH_PREFIX)) {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, encoding: 'utf8' });
    const left = removeDirIfPossible(dir);
    spawnSync('git', ['worktree', 'prune'], { cwd: repo, encoding: 'utf8' });
    if (!left) console.error(`No se pudo borrar ${dir}: está en uso. Bórrala a mano cuando cierre el proceso que la usa.`);
    return left;
  }
  return true;
}

/** Borra una carpeta de la corrida. Devuelve false si Windows la tiene en uso (no lanza). */
function removeDirIfPossible(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return !fs.existsSync(dir);
  }
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
 * Config aislada para el camino solo: un XDG_CONFIG_HOME propio con un opencode.json sin MCP.
 * Así no carga el MCP agent-rack, ni codegraph, ni unityMCP, ni el AGENTS.md global de la config del usuario.
 * El camino solo corre con `--standalone` (verificado: ese modo no carga MCP y escribe en el cwd).
 */
export function isolatedOpencodeConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${BENCH_PREFIX}cfg-`));
  fs.mkdirSync(path.join(root, 'opencode'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'opencode', 'opencode.json'),
    `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {} }, null, 2)}\n`,
    'utf8',
  );
  return root;
}

/**
 * Comando de `opencode run` para cada camino. Solo: `--standalone` con config aislada (sin MCP).
 * Con Silka: el servicio en segundo plano, porque solo ahí se alcanza el MCP agent-rack; ese camino
 * carga la config global del usuario (agent-rack, codegraph, unityMCP y AGENTS.md). Esa asimetría se declara en el informe.
 */
export function opencodeInvocation({ model, silka = false, title, prompt, configDir }) {
  // Una sola línea y comillas escapadas: el prompt viaja como argumento de la shell.
  const line = prompt.replace(/\s+/g, ' ').replace(/"/g, '\\"');
  const standalone = silka ? '' : '--standalone ';
  const cmd = `opencode run --format json --auto ${standalone}--title "${title}" -m ${model} "${line}"`;
  const env = silka || !configDir ? { ...process.env } : { ...process.env, XDG_CONFIG_HOME: configDir };
  return { cmd, env, mode: silka ? 'servicio-global' : 'standalone-config-aislada' };
}

/**
 * Runner de OpenCode. El uso sale de los eventos step_finish del proveedor (opencodeUsageFromJsonl);
 * nunca se estima. Corre con cwd = worktree de la tarea. En el camino con Silka se cuentan las
 * llamadas a silka_execute: si son cero, esa corrida no usó Silka.
 */
export function opencodeRunner({ model, silka = false } = {}) {
  return async (task, { workdir, commit }) => {
    const base = `${task.title}. Alcance: ${task.alcance} Entregable: ${task.entregable}`;
    const prompt = silka ? `${base} ${opencodeSilkaHint(workdir, model)}` : base;
    const configDir = silka ? null : isolatedOpencodeConfig();
    try {
      const inv = opencodeInvocation({
        model,
        silka,
        title: `bench-${task.id}-${silka ? 'silka' : 'solo'}`,
        prompt,
        configDir,
      });
      const run = await runProcess(inv.cmd, { cwd: workdir, env: inv.env, timeoutMs: OPENCODE_TIMEOUT_MS });
      const check = spawnSync(task.verify, { cwd: workdir, encoding: 'utf8', shell: true });
      const diff = spawnSync('git', ['diff', '--name-only', commit], { cwd: workdir, encoding: 'utf8' });
      const changedFiles = diff.status === 0 ? diff.stdout.split(/\r?\n/).filter(Boolean) : null;
      const stdout = run.stdout || '';
      return {
        stdout,
        timedOut: run.timedOut,
        mode: inv.mode,
        usage: opencodeUsageFromJsonl(stdout),
        silkaCalls: silka ? countSilkaCalls(stdout) : 0,
        verify: check.status === 0,
        firstPass: null,
        repairs: null,
        mergeBroke: null,
        changedFiles,
      };
    } finally {
      if (configDir) fs.rmSync(configDir, { recursive: true, force: true });
    }
  };
}

function gitClean(cwd) {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === '';
}

/** Carpeta principal del checkout (no la worktree actual): donde vive agent-rack.config.json del usuario. */
export function mainCheckoutRoot(repo = repoRoot) {
  const common = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
  return common ? path.dirname(common.trim()) : repo;
}

function sha256File(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

/**
 * Borra restos de corridas anteriores: carpetas silka-bench-* en %TEMP% y worktrees con el prefijo
 * en la carpeta base. Nunca toca nada que no empiece por el prefijo.
 */
export function sweepBenchLeftovers(repo = repoRoot) {
  let removed = 0;
  for (const dir of [os.tmpdir(), benchBaseDir(repo)]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names.filter((n) => n.startsWith(BENCH_PREFIX))) {
      const full = path.join(dir, name);
      // Si la carpeta es una worktree registrada, git la quita y deja de tenerla en su lista.
      spawnSync('git', ['worktree', 'remove', '--force', full], { cwd: repo, encoding: 'utf8' });
      if (removeDirIfPossible(full)) removed += 1;
    }
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: repo, encoding: 'utf8' });
  return removed;
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
  // La config del usuario no debe cambiar por correr el benchmark (antes se le añadían rutas temporales).
  const userConfig = path.join(mainCheckoutRoot(repoRoot), 'agent-rack.config.json');
  const configBefore = sha256File(userConfig);
  const leftovers = sweepBenchLeftovers(repoRoot);
  if (leftovers > 0) console.log(`Restos de corridas anteriores borrados: ${leftovers}.`);
  const procsBefore = countOpencodeProcesses();

  const extraLimits =
    proveedor === 'opencode'
      ? [
          'Camino solo: `opencode run --standalone` con config aislada (XDG_CONFIG_HOME propio, sin MCP y sin AGENTS.md global). Verificado: no carga ningún MCP.',
          'Camino con Silka: servicio en segundo plano de opencode, porque solo ahí se alcanza el MCP agent-rack. Carga la config global del usuario (agent-rack, codegraph, unityMCP y AGENTS.md). Ese camino tiene más definiciones y reglas en contexto: la comparación está sesgada contra Silka y el ahorro real sería algo mayor.',
        ]
      : [];
  const runners =
    proveedor === 'opencode'
      ? { solo: opencodeRunner({ model: models.solo }), silka: opencodeRunner({ model: models.silka, silka: true }) }
      : { solo: claudeRunner({ model: models.solo }), silka: claudeRunner({ model: models.silka, silka: true }) };
  let result;
  try {
    result = await runBenchmark({
      commit,
      tasks,
      tasksHash: hash,
      models,
      runners,
      workdirFor: gitWorkdir(repoRoot),
      extraLimits,
      repo: repoRoot,
    });
  } finally {
    sweepBenchLeftovers(repoRoot);
    const procsAfter = countOpencodeProcesses();
    if (procsBefore != null && procsAfter != null) console.log(`Procesos opencode.exe: antes ${procsBefore}, después ${procsAfter} (el servicio en segundo plano cuenta también).`);
  }
  if (sha256File(userConfig) !== configBefore) {
    console.error(`La config del usuario cambió durante la corrida (${userConfig}). Revísala antes de usar este informe.`);
    return 1;
  }
  const file = writeReport(REPORTS_DIR, result.date, result.markdown);
  console.log(`Informe: ${file}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 1; });
}
