import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** Config de Silka. Los tests pueden apuntar a un directorio temporal con SILKA_CONFIG_DIR. */
export function silkaConfigDir() {
  return process.env.SILKA_CONFIG_DIR || path.join(os.homedir(), '.config', 'silka');
}

/**
 * Datos de Silka que no son config (worktrees). Fuera de cualquier repo:
 * %LOCALAPPDATA%\silka en Windows, $XDG_DATA_HOME/silka (o ~/.local/share/silka) en el resto.
 * Los tests lo apuntan a un temporal con SILKA_DATA_DIR.
 */
export function silkaDataDir() {
  if (process.env.SILKA_DATA_DIR) return process.env.SILKA_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'silka');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'silka');
}

/**
 * Carpeta de worktrees de un repo, FUERA del árbol del repo (BUG-06): si un worktree se
 * pierde con un agente dentro, git ya no puede subir de carpeta y caer en el repo principal.
 * Ruta corta a propósito (límite de 260 caracteres en Windows con node_modules profundos).
 */
export function worktreesBase(repoRoot) {
  const abs = path.resolve(repoRoot);
  const slug = path.basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'repo';
  const hash = crypto.createHash('sha1').update(abs.replaceAll('\\', '/').toLowerCase()).digest('hex').slice(0, 8);
  return path.join(silkaDataDir(), 'wt', `${slug}-${hash}`);
}
