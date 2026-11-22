import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Receta del workspace (`silka.json` en la raíz del repo, versionado). Describe cómo se prepara,
 * se levanta y se cierra un worktree de tarea. Sin el archivo, Silka se comporta como antes.
 *
 * Forma:
 *   {
 *     "setup":   "npm install" | ["cmd1", "cmd2"] | { "win": ..., "posix": ... },
 *     "run":     { "dev": "npm run dev", "api": { "win": "...", "posix": "..." } },
 *     "archive": "...",                        (mismas variantes que setup)
 *     "copy":    [".env*"],                    (patrones; ver workspace.mjs)
 *     "ports":   10,                           (tamaño del rango contiguo por tarea)
 *     "runMode": "concurrent" | "exclusive",
 *     "shell":   "pwsh" | "cmd" | "bash"
 *   }
 */

export const RECIPE_FILE = 'silka.json';
export const DEFAULT_PORT_COUNT = 10;
export const RUN_MODES = Object.freeze(['concurrent', 'exclusive']);
export const SHELLS = Object.freeze(['pwsh', 'cmd', 'bash']);
const KEYS = Object.freeze(['setup', 'run', 'archive', 'copy', 'ports', 'runMode', 'shell']);
const NAME_RE = /^[A-Za-z0-9][\w-]{0,40}$/;

/** Un comando o lista de comandos; variantes `win`/`posix` opcionales. */
function checkCommandSpec(value, where, errors) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (!value.trim()) errors.push(`${where}: el comando está vacío`);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.every((c) => typeof c === 'string' && c.trim())) errors.push(`${where}: cada comando debe ser texto no vacío`);
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    const bad = keys.filter((k) => k !== 'win' && k !== 'posix');
    if (bad.length) errors.push(`${where}: variantes desconocidas (${bad.join(', ')}); solo win y posix`);
    if (!keys.length) errors.push(`${where}: el objeto de variantes está vacío`);
    for (const k of keys) checkCommandSpec(value[k], `${where}.${k}`, errors);
    return;
  }
  errors.push(`${where}: se esperaba texto, lista o { win, posix }`);
}

/**
 * Valida la receta cruda. Devuelve la receta normalizada y la lista de errores (vacía si es válida).
 * Las claves desconocidas son error: un typo (p. ej. "runmode") no debe pasar en silencio.
 */
export function validateRecipe(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { recipe: null, errors: ['silka.json debe ser un objeto JSON'] };
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) errors.push(`clave desconocida: ${key}`);
  }
  checkCommandSpec(raw.setup, 'setup', errors);
  checkCommandSpec(raw.archive, 'archive', errors);

  const run = {};
  if (raw.run != null) {
    if (typeof raw.run !== 'object' || Array.isArray(raw.run)) {
      errors.push('run: se esperaba un objeto nombre -> comando');
    } else {
      for (const [name, cmd] of Object.entries(raw.run)) {
        if (!NAME_RE.test(name)) errors.push(`run: nombre no válido "${name}" (letras, números, - y _)`);
        checkCommandSpec(cmd, `run.${name}`, errors);
        run[name] = cmd;
      }
    }
  }

  let copy = [];
  if (raw.copy != null) {
    if (!Array.isArray(raw.copy) || !raw.copy.every((p) => typeof p === 'string' && p.trim())) {
      errors.push('copy: se esperaba una lista de patrones de texto');
    } else {
      copy = raw.copy.map((p) => p.trim());
    }
  }

  let ports = DEFAULT_PORT_COUNT;
  if (raw.ports != null) {
    if (!Number.isInteger(raw.ports) || raw.ports < 1 || raw.ports > 100) {
      errors.push('ports: se esperaba un entero entre 1 y 100');
    } else {
      ports = raw.ports;
    }
  }

  const runMode = raw.runMode ?? 'concurrent';
  if (!RUN_MODES.includes(runMode)) errors.push(`runMode: debe ser ${RUN_MODES.join(' o ')}`);

  const shell = raw.shell ?? null;
  if (shell !== null && !SHELLS.includes(shell)) errors.push(`shell: debe ser ${SHELLS.join(', ')}`);

  if (errors.length) return { recipe: null, errors };
  return {
    recipe: {
      setup: raw.setup ?? null,
      run,
      archive: raw.archive ?? null,
      copy,
      ports,
      runMode,
      shell,
    },
    errors: [],
  };
}

/**
 * Lee `silka.json` de la raíz del repo. `present: false` si no existe (comportamiento de antes).
 * Un archivo que no parsea o no valida no se ignora en silencio: `errors` lo dice.
 */
export function readRecipe(repoRoot) {
  const file = path.join(path.resolve(repoRoot), RECIPE_FILE);
  if (!fs.existsSync(file)) return { present: false, recipe: null, errors: [], file };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { present: true, recipe: null, errors: [`silka.json no es JSON válido: ${err.message}`], file };
  }
  const { recipe, errors } = validateRecipe(raw);
  return { present: true, recipe, errors, file };
}

/**
 * Elige la variante de un comando para la plataforma: `{win, posix}` -> la que toca. Un valor
 * sin variantes vale para todas. Devuelve `null` si no hay nada para esta plataforma.
 */
export function pickVariant(value, platform = process.platform) {
  if (value == null) return null;
  if (typeof value === 'string' || Array.isArray(value)) return value;
  const key = platform === 'win32' ? 'win' : 'posix';
  return value[key] ?? null;
}

/** Lista de comandos (texto o lista) ya elegida para la plataforma. */
export function commandsFor(value, platform = process.platform) {
  const picked = pickVariant(value, platform);
  if (picked == null) return [];
  return (Array.isArray(picked) ? picked : [picked]).map((c) => String(c).trim()).filter(Boolean);
}

/**
 * Sustituye `${NAME}` por el valor de `env` ANTES de lanzar el shell. Así `${SILKA_PORT}` se expande
 * igual en pwsh, cmd y bash (cada shell tiene una sintaxis distinta para variables). Un nombre que
 * no está en `env` se deja tal cual.
 */
export function expandCommand(cmd, env = {}) {
  return String(cmd).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(env, name) ? String(env[name]) : whole);
}

let gitBashCache;
/** Ruta de bash.exe de Git for Windows. Evita el bash de WSL (System32). */
function gitBashPath() {
  if (gitBashCache !== undefined) return gitBashCache;
  gitBashCache = null;
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true });
  for (const gitExe of String(where.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const candidate = path.resolve(path.dirname(gitExe), '..', 'bin', 'bash.exe');
    if (fs.existsSync(candidate)) { gitBashCache = candidate; break; }
  }
  return gitBashCache;
}

let pwshCache;
function windowsPowerShell() {
  if (pwshCache !== undefined) return pwshCache;
  const probe = spawnSync('where.exe', ['pwsh'], { encoding: 'utf8', windowsHide: true });
  pwshCache = probe.status === 0 ? 'pwsh' : 'powershell.exe';
  return pwshCache;
}

/**
 * Cómo lanzar `cmd` con el shell declarado. Devuelve { file, args, verbatim } para spawn.
 * Windows: pwsh (pwsh o powershell.exe), cmd o bash de Git. Posix: sh/bash.
 */
export function shellInvocation(shell, cmd, platform = process.platform) {
  const chosen = shell || (platform === 'win32' ? 'cmd' : 'bash');
  if (platform === 'win32') {
    if (chosen === 'cmd') {
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${cmd}"`], verbatim: true };
    }
    if (chosen === 'pwsh') {
      return { file: windowsPowerShell(), args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], verbatim: false };
    }
    if (chosen === 'bash') {
      const bash = gitBashPath();
      if (!bash) throw new Error('shell bash: no encuentro bash.exe de Git for Windows (no uso el de WSL)');
      return { file: bash, args: ['-c', cmd], verbatim: false };
    }
    throw new Error(`shell desconocido: ${chosen}`);
  }
  if (chosen === 'cmd' || chosen === 'pwsh') {
    throw new Error(`shell ${chosen} solo existe en Windows en esta receta`);
  }
  return { file: 'bash', args: ['-c', cmd], verbatim: false };
}

/** Shell efectivo de la receta (la declarada o el de la plataforma). */
export function effectiveShell(recipe, platform = process.platform) {
  if (recipe?.shell) return recipe.shell;
  return platform === 'win32' ? 'cmd' : 'bash';
}

/**
 * Variables estándar de una tarea (FR-TK-14). `SILKA_PORT` es el primer puerto del rango; los
 * `SILKA_PORT_n` que ya existían se conservan.
 */
export function workspaceEnv({ taskId, worktreePath, rootPath, workspaceName, defaultBranch, ports = [] }) {
  const env = {};
  (ports || []).forEach((p, i) => { env[`SILKA_PORT_${i + 1}`] = String(p); });
  if (ports && ports.length) env.SILKA_PORT = String(ports[0]);
  if (worktreePath) env.SILKA_WORKSPACE_PATH = path.resolve(worktreePath);
  if (rootPath) env.SILKA_ROOT_PATH = path.resolve(rootPath);
  if (workspaceName) env.SILKA_WORKSPACE_NAME = String(workspaceName);
  if (taskId) env.SILKA_TASK_ID = String(taskId);
  if (defaultBranch) env.SILKA_DEFAULT_BRANCH = String(defaultBranch);
  return env;
}
