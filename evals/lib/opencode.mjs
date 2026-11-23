// Lanzador de OpenCode para las evals, compatible con Windows.
//
// `spawnSync('opencode')` falla en Windows (ENOENT; con .cmd, EINVAL) porque opencode es un shim. Aquí se
// lanza con shell, el prompt viaja por stdin y, si vence el tiempo, se cierra el árbol de procesos por el PID
// de Windows que da Node (nunca con PIDs de `ps`).

import { spawn, spawnSync } from 'node:child_process';

export const TIEMPO_LIMITE_MS = 180_000;

/** Cierra el árbol de procesos de un PID. Devuelve true si taskkill lo logró. */
function cerrarArbol(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    return spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).status === 0;
  }
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/**
 * Interpreta la salida JSON de `opencode run --format json`: texto en `part.text` de los eventos `text`,
 * y uso en `part.tokens` / `part.cost` de los `step_finish`. Si no hay uso, devuelve null (sin dato).
 */
export function interpretarSalida(stdout) {
  let texto = '';
  let pasos = 0;
  const uso = { tokens_entrada: 0, tokens_salida: 0, usd: 0 };
  for (const linea of String(stdout ?? '').split(/\r?\n/)) {
    if (!linea.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(linea);
    } catch {
      continue;
    }
    const part = ev?.part ?? {};
    if (ev?.type === 'text' && typeof part.text === 'string') texto += part.text;
    if (ev?.type === 'step_finish' && part.tokens) {
      pasos += 1;
      const t = part.tokens;
      const c = t.cache ?? {};
      uso.tokens_entrada += (t.input ?? 0) + (c.read ?? 0) + (c.write ?? 0);
      uso.tokens_salida += (t.output ?? 0) + (t.reasoning ?? 0);
      uso.usd += part.cost ?? 0;
    }
  }
  return { texto, uso: pasos ? uso : null };
}

/**
 * Ejecuta OpenCode con un prompt y devuelve { stdout, texto, uso }. Lanza error claro si no está instalado,
 * si sale con código distinto de cero o si vence el tiempo (en ese caso cierra el árbol de procesos).
 */
export function ejecutarOpenCode(prompt, { modelo, tiempoMs = TIEMPO_LIMITE_MS } = {}) {
  return new Promise((resolve, reject) => {
    const comando = `opencode run --format json --standalone --model ${modelo}`;
    const hijo = spawn(comando, { shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let vencio = false;
    const reloj = setTimeout(() => {
      vencio = true;
      cerrarArbol(hijo.pid);
    }, tiempoMs);
    hijo.stdout.on('data', (d) => (stdout += d));
    hijo.stderr.on('data', (d) => (stderr += d));
    hijo.on('error', (e) => {
      clearTimeout(reloj);
      reject(new Error(`opencode falló al lanzarse: ${e.message}`));
    });
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (vencio) return reject(new Error(`opencode venció el tiempo (${tiempoMs} ms) y se cerró su árbol de procesos`));
      if (codigo !== 0) {
        const noEsta = /not recognized|no se reconoce|not found/i.test(stderr);
        return reject(new Error(noEsta ? 'opencode no está en el PATH; usa --modelo fake' : `opencode salió con código ${codigo}: ${stderr.slice(0, 200)}`));
      }
      resolve({ stdout, ...interpretarSalida(stdout) });
    });
    hijo.stdin.on('error', () => {});
    hijo.stdin.end(String(prompt));
  });
}
