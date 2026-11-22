import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lista de denegación de archivos sensibles (SEC-17). Los agentes no reciben estos archivos en su
 * worktree ni en su contexto, y una ficha cuyo diff los toque sube a riesgo alto (SEC-08).
 *
 * Sintaxis tipo .gitignore: cada patrón es un glob (`*`, `**`, `?`); sin `/` se compara con el
 * nombre del archivo, con `/` se compara con la ruta relativa al repo. `~/` apunta al home del
 * usuario y se compara con la ruta absoluta. Un patrón con `!` al inicio vuelve a permitir lo que
 * casó antes (gana el último que case). La configuración puede sustituir la lista entera con
 * `secretDenylist` en agent-rack/silka config; sin ella, rige la lista por defecto.
 */
export const DEFAULT_SECRET_DENYLIST = Object.freeze([
  '.env*',
  '!.env.example',
  '~/.ssh/**',
  '*.pem',
  '*.key',
  'id_*',
]);

/** La lista activa: la de la config si es un arreglo de cadenas, si no la por defecto. */
export function secretDenylist(config) {
  const list = config?.secretDenylist;
  if (Array.isArray(list) && list.every((p) => typeof p === 'string')) return [...list];
  return [...DEFAULT_SECRET_DENYLIST];
}

/**
 * Lista de la config de Silka (la misma que lee hub.loadSilkaConfig: SILKA_CONFIG o
 * agent-rack.config.json en la raíz de Silka). Se lee aquí y no con hub.mjs para no crear un ciclo
 * (hub arranca el supervisor, que usa el manager). Si no hay config o no se puede leer, rige la
 * lista por defecto: nunca se desactiva la protección por un error de lectura.
 */
export function silkaSecretDenylist() {
  try {
    const silkaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const configPath = process.env.SILKA_CONFIG
      ? path.resolve(process.env.SILKA_CONFIG)
      : path.join(silkaRoot, 'agent-rack.config.json');
    return secretDenylist(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return secretDenylist(null);
  }
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesOne(pattern, file, { homeDir }) {
  if (pattern.startsWith('~/')) {
    const home = normalize(homeDir || os.homedir()).replace(/\/$/, '');
    return globToRegExp(`${home}/${pattern.slice(2)}`).test(normalize(file));
  }
  if (pattern.includes('/')) {
    return globToRegExp(pattern.replace(/^\//, '')).test(normalize(file).replace(/^\//, ''));
  }
  const base = normalize(file).split('/').pop();
  return globToRegExp(pattern).test(base);
}

/** ¿Está el archivo en la lista de denegación? `file` puede ser relativo al repo o absoluto. */
export function isDeniedPath(file, patterns = DEFAULT_SECRET_DENYLIST, options = {}) {
  let denied = false;
  for (const raw of patterns) {
    const negate = raw.startsWith('!');
    const pattern = negate ? raw.slice(1) : raw;
    if (!pattern || !matchesOne(pattern, file, options)) continue;
    denied = !negate;
  }
  return denied;
}

/** Filtra la lista de rutas y devuelve solo las denegadas. */
export function deniedFiles(files, patterns = DEFAULT_SECRET_DENYLIST, options = {}) {
  return (files || []).filter((file) => isDeniedPath(file, patterns, options));
}
