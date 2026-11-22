import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { harnessFreeEnv } from '../hub.mjs';
import { worktreesBase } from '../paths.mjs';
import { withFileLock } from '../lock.mjs';
import { gitRun } from './git.mjs';
import { isDeniedPath, matchesGlob, silkaSecretDenylist } from './denylist.mjs';
import { expandCommand, shellInvocation } from './recipe.mjs';
import { portsAreFree } from './ports.mjs';
import { spawnShellCommand } from './verify.mjs';

/*
 * Ciclo del workspace (FR-TK-13 a FR-TK-15): copia de archivos que git no versiona, y `run`, `stop`
 * y `archive` de una tarea. El estado de cada `run` vive en el worktree (`.silka/runs/<nombre>.json`,
 * excluido de git por excludeSilkaDir), así sobrevive a que termine el proceso que lo lanzó.
 */

const RUNS_DIR = path.join('.silka', 'runs');

// ---------------------------------------------------------------------------------------------
// Copia (FR-TK-13)
// ---------------------------------------------------------------------------------------------

function readWorktreeInclude(repoRoot) {
  const file = path.join(path.resolve(repoRoot), '.worktreeinclude');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Archivos que git no versiona (ignorados o sin añadir), sin entrar en directorios ignorados. */
function unversionedFiles(repoRoot) {
  const files = new Set();
  for (const args of [
    ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'],
    ['ls-files', '-o', '--exclude-standard', '--directory', '-z'],
  ]) {
    const r = gitRun(repoRoot, args, { repoRoot });
    if (!r.ok) continue;
    for (const f of r.stdout.split('\0')) {
      if (f && !f.endsWith('/')) files.add(f.replace(/\\/g, '/'));
    }
  }
  return [...files];
}

/**
 * Copia al worktree los archivos de `recipe.copy` y de `.worktreeinclude` que el repo no versiona.
 * Un patrón sin comodines es una ruta literal; con comodines se casa con los archivos no versionados
 * (misma sintaxis que la lista de denegación). Lo que la lista de secretos deniegue NO se copia, y
 * se devuelve en `skipped` con el motivo. No sobrescribe lo que ya exista en el worktree.
 */
export function copyWorkspaceFiles(repoRoot, wt, recipe, { denylist = silkaSecretDenylist(), homeDir } = {}) {
  const patterns = [...(recipe?.copy || []), ...readWorktreeInclude(repoRoot)];
  const copied = [];
  const skipped = [];
  if (!patterns.length) return { copied, skipped };
  const root = path.resolve(repoRoot);
  const target = path.resolve(wt);
  let candidatesCache = null;
  const seen = new Set();

  for (const raw of patterns) {
    const pattern = raw.replace(/^\.\//, '').replace(/\\/g, '/');
    const isGlob = /[*?]/.test(pattern);
    let candidates;
    if (isGlob) {
      candidatesCache ??= unversionedFiles(repoRoot);
      candidates = candidatesCache.filter((f) => matchesGlob(pattern, f, { homeDir }));
    } else {
      candidates = [pattern];
    }
    for (const file of candidates) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (isDeniedPath(file, denylist, { homeDir })) {
        skipped.push({ file, reason: 'denegado por la lista de secretos' });
        continue;
      }
      const src = path.join(root, file);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        skipped.push({ file, reason: 'no existe o no es un archivo' });
        continue;
      }
      const dst = path.join(target, file);
      if (fs.existsSync(dst)) {
        skipped.push({ file, reason: 'ya existe en el worktree' });
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied.push(file);
    }
  }
  return { copied, skipped };
}

// ---------------------------------------------------------------------------------------------
// Procesos de `run` (FR-TK-15)
// ---------------------------------------------------------------------------------------------

function runFile(wt, name) {
  return path.join(path.resolve(wt), RUNS_DIR, `${name}.json`);
}

function readRunState(wt, name) {
  try {
    return JSON.parse(fs.readFileSync(runFile(wt, name), 'utf8'));
  } catch {
    return null;
  }
}

export function isPidAlive(pid) {
  if (!Number(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Procesos `run` registrados en un worktree, con su estado vivo. */
export function listWorkspaceRuns(wt) {
  const dir = path.join(path.resolve(wt), RUNS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const state = readRunState(wt, f.slice(0, -5));
      return state ? { ...state, alive: isPidAlive(state.pid) } : null;
    })
    .filter(Boolean);
}

/** Runs vivos de todas las tareas de un repo (para runMode exclusive). */
export function liveRunsInRepo(repoRoot) {
  const base = worktreesBase(repoRoot);
  if (!fs.existsSync(base)) return [];
  const live = [];
  for (const taskId of fs.readdirSync(base)) {
    const wt = path.join(base, taskId);
    for (const run of listWorkspaceRuns(wt)) {
      if (run.alive) live.push({ ...run, taskId });
    }
  }
  return live;
}

/** Cierra el árbol de procesos de un pid. Windows: taskkill /T /F; posix: grupo de procesos. */
function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ya terminó */ }
  }
}

/**
 * Lanza un comando `run` de la receta en el worktree. Con `runMode: exclusive` rechaza el arranque
 * si ya hay un `run` vivo en cualquier tarea del repo (comprobado bajo lock, FR-TK-15 / WR-05).
 */
export function startWorkspaceRun({ repoRoot, wt, name, command, shell = null, env = {}, runMode = 'concurrent' }) {
  const lockDir = worktreesBase(repoRoot);
  fs.mkdirSync(lockDir, { recursive: true });
  return withFileLock(path.join(lockDir, '.workspace-runs.lock'), () => {
    if (runMode === 'exclusive') {
      const live = liveRunsInRepo(repoRoot);
      if (live.length) {
        const first = live[0];
        throw new Error(`runMode exclusive: ya corre "${first.name}" de la tarea ${first.taskId} (pid ${first.pid})`);
      }
    }
    const current = readRunState(wt, name);
    if (current && isPidAlive(current.pid)) {
      throw new Error(`"${name}" ya corre en esta tarea (pid ${current.pid})`);
    }
    const cmd = expandCommand(command, env);
    const inv = shellInvocation(shell, cmd);
    const dir = path.join(path.resolve(wt), RUNS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, `${name}.log`);
    const fd = fs.openSync(logPath, 'a');
    let child;
    try {
      child = spawn(inv.file, inv.args, {
        cwd: wt,
        env: { ...harnessFreeEnv(process.env), ...env },
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        windowsVerbatimArguments: inv.verbatim,
      });
    } finally {
      fs.closeSync(fd);
    }
    child.unref();
    if (!child.pid) throw new Error(`no pude lanzar "${name}"`);
    const state = { name, pid: child.pid, command: cmd, shell: shell || null, startedAt: new Date().toISOString(), log: logPath };
    fs.writeFileSync(runFile(wt, name), `${JSON.stringify(state, null, 2)}\n`);
    return state;
  });
}

/**
 * Detiene un `run` y su árbol de procesos. Comprueba que el pid ya no vive y, si el run declara
 * puertos, que se han liberado (así no queda un servidor huérfano tomando el puerto).
 */
export function stopWorkspaceRun(wt, name, { ports = [] } = {}) {
  const state = readRunState(wt, name);
  if (!state) return { name, stopped: false, reason: 'no_corre' };
  if (isPidAlive(state.pid)) killTree(state.pid);
  for (let i = 0; i < 50 && isPidAlive(state.pid); i += 1) sleepSync(100);
  if (isPidAlive(state.pid)) return { name, stopped: false, reason: 'sigue_vivo', pid: state.pid };
  fs.rmSync(runFile(wt, name), { force: true });
  const portsFree = portsAreFree(ports);
  return { name, stopped: true, pid: state.pid, portsFree };
}

/** Detiene todos los `run` vivos de un worktree. */
export function stopAllWorkspaceRuns(wt, opts = {}) {
  return listWorkspaceRuns(wt).map((run) => stopWorkspaceRun(wt, run.name, opts));
}

/**
 * Ejecuta los comandos `archive` de la receta en el worktree, con el shell y el entorno de la
 * tarea. Se corre antes de quitar el worktree; un fallo se devuelve, no frena el cierre.
 */
export function runArchiveCommands(wt, commands, { shell = null, env = {}, timeoutMs = 120_000 } = {}) {
  return commands.map((cmd) => {
    const r = spawnShellCommand(wt, cmd, { shell, env, timeoutMs });
    return { cmd, ok: r.status === 0, exitCode: r.status ?? null };
  });
}
