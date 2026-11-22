// Comprobaciones de `silka doctor`. Cada una recibe un contexto (ver makeContext) y devuelve uno o
// varios puntos. Solo leen: ninguna escribe, mata procesos ni cambia configuración (DR-04).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readProcessStartMs } from '../lock.mjs';
import { silkaConfigDir, worktreesBase } from '../paths.mjs';
import { listTaskRepos } from '../tasks/repo-registry.mjs';
import { readTaskStore } from '../tasks/store.mjs';
import { detectAgents, entriesFromConfig, findInPath } from '../agents/detect.mjs';
import { point, STATUS } from './result.mjs';

export { findInPath };

const HUB_RE = /cli\.mjs"?\s+hub\s*$/i;
const BRIDGE_RE = /cli\.mjs"?\s+bridge\s*$/i;
const LARGE_NOTES_BYTES = 5 * 1024 * 1024;
const LARGE_LOGS_BYTES = 200 * 1024 * 1024;
const LARGE_REGISTRY_ENTRIES = 50;

const norm = (p) => path.resolve(String(p)).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

/** ¿La carpeta `target` cae dentro de alguna de las permitidas (misma regla que agent-rack)? */
export function coversPath(allowed, target) {
  const t = norm(target);
  return (Array.isArray(allowed) ? allowed : []).some((w) => {
    const base = norm(w);
    return t === base || t.startsWith(`${base}/`);
  });
}

/** Procesos vivos con su línea de comando. En Windows, PowerShell; en el resto, ps. */
export function listProcesses() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
      const parsed = JSON.parse(out || '[]');
      return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
        pid: Number(p.ProcessId), name: String(p.Name ?? ''), commandLine: String(p.CommandLine ?? ''),
      }));
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 15_000 });
    return out.split(/\r?\n/).flatMap((line) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m) return [];
      const args = m[2];
      return [{ pid: Number(m[1]), name: path.basename(args.split(' ')[0]), commandLine: args }];
    });
  } catch {
    return [];
  }
}

/** Procesos node que corren `cli.mjs <rol>` (hub o bridge). */
export function findRoleProcesses(procs, role) {
  const re = role === 'hub' ? HUB_RE : BRIDGE_RE;
  return procs.filter((p) => /^node(\.exe)?$/i.test(p.name) && re.test(p.commandLine || ''));
}

/** Hora (ms) del último cambio de src/silka en git; null si no hay repo o git falla. */
export function lastSilkaChangeMs(root) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', 'src/silka'], {
      cwd: root, encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const seconds = Number(out);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** ¿Hay algo escuchando en el puerto? Solo conecta y cierra; no envía nada. */
export function probePort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Tamaño de un árbol de archivos (sin seguir enlaces). Tope de profundidad para no recorrer de más. */
export function dirBytes(dir, depth = 6) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory() && depth > 0) total += dirBytes(full, depth - 1);
      else if (e.isFile()) total += fs.statSync(full).size;
    } catch { /* archivo que desaparece */ }
  }
  return total;
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Contexto por defecto. Las pruebas sustituyen piezas (procesos, puerto, config, repos) para no
 * depender del equipo; la CLI usa estos valores reales.
 */
export async function makeContext(overrides = {}) {
  const hub = await import('../hub.mjs');
  const { DEFAULT_SSE_PORT } = await import('agent-rack/dist/config/schema.js');
  const base = {
    env: process.env,
    home: os.homedir(),
    nodeVersion: process.version,
    root: hub.repoRoot(),
    loadConfig: () => hub.loadSilkaConfig(),
    defaultPort: DEFAULT_SSE_PORT,
    runtimeFor: (port) => hub.readRuntime(port),
    worktreesRoot: () => hub.silkaWorktreesRoot(),
    listProcesses,
    startOf: readProcessStartMs,
    probePort,
    lastChangeMs: () => lastSilkaChangeMs(hub.repoRoot()),
    repos: () => listRegistry(),
    worktreeTools: { listTaskRepos, worktreesBase },
    taskWorktrees: (repo) => readTaskStore(repo).tasks.map((t) => t.worktreePath).filter(Boolean),
    configDir: silkaConfigDir(),
    hubLogFile: hub.hubLogPath(),
  };
  return { ...base, ...overrides };
}

// Registro de repos sin filtrar (para contar las entradas que ya no existen).
function listRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(silkaConfigDir(), 'task-repos.json'), 'utf8'));
    return Array.isArray(parsed?.repos) ? parsed.repos.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Puntos

export function checkNode(ctx) {
  const major = Number(String(ctx.nodeVersion).replace(/^v/, '').split('.')[0]);
  if (major >= 20) return point({ id: 'node', name: `Node ${ctx.nodeVersion}`, status: STATUS.OK });
  return point({
    id: 'node', name: `Node ${ctx.nodeVersion}`, status: STATUS.FAIL,
    cause: 'Silka necesita Node 20 o superior',
    fix: 'instala Node 20 o superior y vuelve a abrir la terminal',
  });
}

/** agent-rack instalado y el agent-rack.config.json del repo presente y legible. */
export function checkAgentRack(ctx) {
  const out = [];
  let version = null;
  try {
    const req = createRequire(path.join(ctx.root, 'package.json'));
    version = JSON.parse(fs.readFileSync(req.resolve('agent-rack/package.json'), 'utf8')).version;
  } catch {
    return point({
      id: 'agent-rack', name: 'agent-rack instalado', status: STATUS.FAIL,
      cause: 'no se encuentra el paquete agent-rack en node_modules',
      fix: 'corre: npm install (o npm run setup)',
    });
  }
  out.push(point({ id: 'agent-rack', name: `agent-rack ${version} instalado`, status: STATUS.OK }));
  try {
    ctx.loadConfig();
    out.push(point({ id: 'config', name: 'agent-rack.config.json legible', status: STATUS.OK }));
  } catch (err) {
    out.push(point({
      id: 'config', name: 'agent-rack.config.json', status: STATUS.FAIL,
      cause: err instanceof Error ? err.message : String(err),
      fix: 'corre: npm run setup para generar la configuración',
    }));
  }
  return out;
}

/**
 * La carpeta de worktrees de Silka debe estar en allowedWorkspaces del agent-rack que corre
 * (BUG-08). Se mira la config efectiva que escribió el último hub para este puerto.
 */
export function checkWorktreesAllowed(ctx) {
  const id = 'worktrees-allowed';
  const name = 'carpeta de worktrees permitida';
  let port;
  try {
    port = ctx.loadConfig().port;
  } catch {
    port = ctx.defaultPort;
  }
  const wt = ctx.worktreesRoot();
  const effective = path.join(ctx.configDir, `agent-rack.effective-${port}.json`);
  if (!fs.existsSync(effective)) {
    return point({
      id, name, status: STATUS.WARN,
      cause: `aún no hay configuración efectiva para el puerto ${port}: el hub no ha arrancado`,
      fix: 'arranca el hub con: silka hub',
    });
  }
  let allowed = [];
  try {
    allowed = JSON.parse(fs.readFileSync(effective, 'utf8')).allowedWorkspaces ?? [];
  } catch {
    allowed = [];
  }
  if (coversPath(allowed, wt)) return point({ id, name, status: STATUS.OK });
  return point({
    id, name, status: STATUS.FAIL,
    cause: `agent-rack no permite ${wt}; ninguna tarea aislada podrá arrancar ("is not within allowedWorkspaces")`,
    fix: 'reinicia el hub con silka hub para que regenere la configuración efectiva',
  });
}

/** Hubs vivos: uno solo, y respondiendo. */
export async function checkHubs(ctx) {
  const procs = ctx.listProcesses();
  const hubs = findRoleProcesses(procs, 'hub');
  if (hubs.length === 0) {
    return point({
      id: 'hub', name: 'hub', status: STATUS.WARN,
      cause: 'no hay ningún hub en marcha',
      fix: 'si vas a usar Silka, arráncalo con: silka hub',
    });
  }
  if (hubs.length > 1) {
    return point({
      id: 'hub', name: 'hub', status: STATUS.FAIL,
      cause: `hay ${hubs.length} hubs vivos (pids ${hubs.map((h) => h.pid).join(', ')}); se pisan al supervisar las tareas`,
      fix: 'cierra los sobrantes a mano (deja el que figura en hub-<puerto>.owner.json)',
    });
  }
  let port = ctx.defaultPort;
  try { port = ctx.loadConfig().port; } catch { /* sin config: puerto por defecto */ }
  const responds = await ctx.probePort(port);
  if (responds) return point({ id: 'hub', name: `un hub vivo (pid ${hubs[0].pid}) respondiendo en ${port}`, status: STATUS.OK });
  return point({
    id: 'hub', name: `hub (pid ${hubs[0].pid})`, status: STATUS.FAIL,
    cause: `el proceso del hub está vivo pero no responde en el puerto ${port}`,
    fix: 'ciérralo a mano y arráncalo de nuevo con: silka hub',
  });
}

/** Hubs y bridges vivos que arrancaron antes del último cambio de src/silka (código viejo). */
export async function checkRunningCodeAge(ctx) {
  const out = [];
  const lastChange = ctx.lastChangeMs();
  const procs = ctx.listProcesses();
  const roles = [
    { role: 'bridge', id: 'bridge', label: 'bridge MCP', fix: 'reconecta el MCP o abre una sesión nueva' },
    { role: 'hub', id: 'hub-code', label: 'hub', fix: 'reinicia el hub con silka hub' },
  ];
  for (const r of roles) {
    const alive = findRoleProcesses(procs, r.role);
    if (alive.length === 0) continue;
    if (!lastChange) {
      out.push(point({ id: r.id, name: `${r.label} con código actual`, status: STATUS.WARN, cause: 'no se pudo leer la fecha del último cambio en git', fix: 'comprueba a mano que el repo tiene historial' }));
      continue;
    }
    const stale = [];
    for (const p of alive) {
      const started = await ctx.startOf(p.pid);
      if (Number.isFinite(started) && started + 5000 < lastChange) stale.push(p.pid);
    }
    if (stale.length) {
      out.push(point({
        id: r.id, name: `${r.label} con código actual`, status: STATUS.WARN,
        cause: `arrancó antes del último cambio de Silka (pids ${stale.join(', ')}) y corre código anterior`,
        fix: r.fix,
      }));
    } else {
      out.push(point({ id: r.id, name: `${r.label} con código actual (${alive.length})`, status: STATUS.OK }));
    }
  }
  if (out.length === 0) out.push(point({ id: 'bridge', name: 'bridges y hub con código actual (ninguno en marcha)', status: STATUS.OK }));
  return out;
}

/** Cada CLI de agente configurada: instalada y con sesión iniciada (si se puede comprobar). */
export function checkAgentClis(ctx) {
  let config;
  try {
    config = ctx.loadConfig().config;
  } catch {
    return point({ id: 'agent-clis', name: 'CLIs de agentes', status: STATUS.WARN, cause: 'sin configuración no se pueden revisar las CLI', fix: 'corrige agent-rack.config.json (ver el punto de configuración)' });
  }
  const out = [];
  const detected = detectAgents(entriesFromConfig(config.agents), { env: ctx.env, home: ctx.home });
  for (const { agent, bin, installed, authFile, session } of detected) {
    const id = `cli-${agent}`;
    if (!installed) {
      out.push(point({ id, name: `CLI de ${agent}`, status: STATUS.FAIL, cause: `no se encuentra "${bin ?? '(sin comando)'}" en PATH`, fix: `instala la CLI de ${agent} y abre una terminal nueva` }));
    } else if (session === null) {
      out.push(point({ id, name: `CLI de ${agent} instalada`, status: STATUS.WARN, cause: 'no se puede comprobar la sesión desde Silka', fix: `comprueba a mano que ${agent} tiene sesión iniciada` }));
    } else if (session) {
      out.push(point({ id, name: `CLI de ${agent} instalada y con sesión`, status: STATUS.OK }));
    } else {
      out.push(point({ id, name: `CLI de ${agent} sin sesión`, status: STATUS.FAIL, cause: `no hay credenciales de ${agent} (${authFile})`, fix: `inicia sesión en ${agent} desde su terminal` }));
    }
  }
  return out.length ? out : point({ id: 'agent-clis', name: 'CLIs de agentes', status: STATUS.WARN, cause: 'no hay agentes en la configuración', fix: 'añade un agente en agent-rack.config.json' });
}

/** Repos del registro: entradas que ya no existen o no tienen tareas. */
export function checkRepoRegistry(ctx) {
  const entries = ctx.repos();
  const stale = entries.filter((repo) => !fs.existsSync(path.join(repo, '.silka', 'tasks-v1')));
  if (stale.length === 0 && entries.length <= LARGE_REGISTRY_ENTRIES) {
    return point({ id: 'registry', name: `registro de repos (${entries.length})`, status: STATUS.OK });
  }
  const cause = stale.length
    ? `${stale.length} de ${entries.length} repos del registro ya no existen o no tienen tareas`
    : `el registro tiene ${entries.length} repos`;
  return point({
    id: 'registry', name: `registro de repos (${entries.length})`, status: STATUS.WARN,
    cause, fix: 'el hub ignora esas entradas; para limpiar, borra las líneas sobrantes de task-repos.json en la config de Silka',
  });
}

/** Worktrees huérfanos y enlaces de node_modules rotos, en los repos registrados. */
export function checkWorktrees(ctx) {
  let orphans = 0;
  const brokenLinks = [];
  for (const repo of ctx.worktreeTools.listTaskRepos()) {
    const base = ctx.worktreeTools.worktreesBase(repo);
    if (!fs.existsSync(base)) continue;
    const referenced = new Set(ctx.taskWorktrees(repo).map((w) => norm(w)));
    for (const dirent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(base, dirent.name);
      if (!referenced.has(norm(dir))) orphans += 1;
      if (isBrokenLink(path.join(dir, 'node_modules'))) brokenLinks.push(dir);
    }
  }
  return [
    orphans
      ? point({ id: 'worktrees', name: `worktrees huérfanos (${orphans})`, status: STATUS.WARN, cause: `${orphans} carpeta(s) de worktree sin tarea que las use`, fix: 'revisa con: silka task ls; los que sobren se quitan con git worktree remove, soltando antes node_modules (cmd /c rmdir node_modules, sin /s)' })
      : point({ id: 'worktrees', name: 'worktrees huérfanos (ninguno)', status: STATUS.OK }),
    brokenLinks.length
      ? point({ id: 'node-modules-links', name: `enlaces de node_modules (${brokenLinks.length} rotos)`, status: STATUS.WARN, cause: `enlace de node_modules roto en ${brokenLinks.length} worktree(s)`, fix: 'quita el enlace roto sin borrar el destino: cmd /c rmdir <worktree>\\node_modules (sin /s)' })
      : point({ id: 'node-modules-links', name: 'enlaces de node_modules (ninguno roto)', status: STATUS.OK }),
  ];
}

/** Enlace (junction o symlink) cuyo destino ya no existe. */
export function isBrokenLink(nm) {
  let st;
  try { st = fs.lstatSync(nm); } catch { return false; }
  if (fs.existsSync(nm)) return false;
  if (st.isSymbolicLink()) return true;
  try { return Boolean(fs.readlinkSync(nm)); } catch { return false; }
}

/** Tamaño de notas, logs del hub y logs de tareas. */
export function checkSizes(ctx) {
  const out = [];
  const notes = fileBytes(path.join(ctx.configDir, 'notes.jsonl'));
  out.push(notes > LARGE_NOTES_BYTES
    ? point({ id: 'notes', name: `notas (${mb(notes)})`, status: STATUS.WARN, cause: 'el archivo de notas pasa de 5 MB', fix: 'archiva o borra notas viejas de notes.jsonl' })
    : point({ id: 'notes', name: `notas (${mb(notes)})`, status: STATUS.OK }));
  let logs = dirBytes(path.join(ctx.configDir, 'logs'));
  for (const repo of ctx.repos()) logs += dirBytes(path.join(repo, '.silka', 'tasks-v1', 'logs'));
  out.push(logs > LARGE_LOGS_BYTES
    ? point({ id: 'logs', name: `logs (${mb(logs)})`, status: STATUS.WARN, cause: 'los logs pasan de 200 MB', fix: 'borra los logs de tareas viejas (carpeta logs de cada repo y de la config de Silka)' })
    : point({ id: 'logs', name: `logs (${mb(logs)})`, status: STATUS.OK }));
  return out;
}

/** Todas las comprobaciones, en el orden en que se muestran. */
export function defaultChecks() {
  return [
    checkNode,
    checkAgentRack,
    checkWorktreesAllowed,
    checkHubs,
    checkRunningCodeAge,
    checkAgentClis,
    checkWorktrees,
    checkRepoRegistry,
    checkSizes,
  ];
}

