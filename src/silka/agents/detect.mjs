// Detección de CLIs de agentes (codex, opencode, cursor): si el binario está en el PATH y si hay
// credenciales. Solo lee: no lanza el agente, no instala nada ni toca configuración. La usan
// `silka doctor` (checkAgentClis) y `silka setup`, para que ambos vean lo mismo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Agentes que Silka conoce: el binario se busca en los argumentos del shim (p. ej. `shim codex exec`). */
export const KNOWN_AGENT_BINS = ['codex', 'opencode', 'cursor'];

/** Busca un ejecutable en el PATH dado (sin lanzarlo). En Windows prueba las extensiones habituales. */
export function findInPath(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.ps1'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch { /* no está aquí */ }
    }
  }
  return null;
}

/** Fichero de credenciales que cada CLI deja al iniciar sesión; null si no se sabe comprobarlo. */
export function authFileFor(agent, { env = process.env, home = os.homedir() } = {}) {
  if (agent === 'codex') return path.join(home, '.codex', 'auth.json');
  if (agent === 'opencode') return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'auth.json');
  return null;
}

/**
 * Comprueba una lista de agentes `[{ agent, bin }]`. Devuelve, por agente:
 * - installed: el binario está en el PATH;
 * - authFile: ruta de credenciales (o null si no se puede comprobar);
 * - session: true / false si hay credenciales o no; null si no se puede comprobar.
 */
export function detectAgents(entries, { env = process.env, home = os.homedir() } = {}) {
  return entries.map(({ agent, bin }) => {
    // `bin` puede ser una lista de candidatos (cursor instala `cursor-agent` o `agent`).
    const candidates = (Array.isArray(bin) ? bin : [bin]).filter(Boolean);
    const found = candidates.find((b) => findInPath(b, env)) ?? null;
    const authFile = authFileFor(agent, { env, home });
    const session = authFile ? fs.existsSync(authFile) : null;
    return { agent, bin: found ?? candidates[0] ?? null, installed: Boolean(found), authFile, session };
  });
}

/** Entradas `{ agent, bin }` a partir de la sección `agents` de agent-rack.config.json. */
export function entriesFromConfig(agents = {}) {
  return Object.entries(agents).map(([agent, spec]) => {
    const args = Array.isArray(spec?.args) ? spec.args.map(String) : [];
    const bin = args.find((a) => KNOWN_AGENT_BINS.includes(a)) || spec?.command || null;
    return { agent, bin };
  });
}
