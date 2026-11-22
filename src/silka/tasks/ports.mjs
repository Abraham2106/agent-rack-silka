import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonRetry, withFileLock, writeAtomic } from '../lock.mjs';

function portsFile(repoRoot) {
  return path.join(repoRoot, '.silka', 'ports.json');
}

function portsLock(repoRoot) {
  return `${portsFile(repoRoot)}.lock`;
}

function readPorts(repoRoot) {
  return readJsonRetry(portsFile(repoRoot), {
    retries: 1,
    fallback: { allocated: {}, next: 19000 },
  });
}

function writePorts(repoRoot, data) {
  writeAtomic(portsFile(repoRoot), `${JSON.stringify(data, null, 2)}\n`);
}

const FIRST_PORT = 19000;
const LAST_PORT = 65500;
const MAX_PROBE_ROUNDS = 40;

/**
 * ¿Están libres todos estos puertos en 127.0.0.1 y en todas las interfaces? Se comprueba en un
 * proceso node aparte (síncrono, como el resto de la asignación). Un puerto ocupado por un servidor
 * ajeno hace fallar la comprobación.
 */
export function portsAreFree(ports) {
  if (!ports.length) return true;
  const code = `
    const net = require('net');
    const ports = process.argv.slice(1).map(Number);
    let i = 0;
    const next = () => {
      if (i >= ports.length) process.exit(0);
      const s = net.createServer();
      s.once('error', () => process.exit(1));
      s.listen({ port: ports[i], exclusive: true }, () => s.close(() => { i += 1; next(); }));
    };
    next();`;
  const r = spawnSync(process.execPath, ['-e', code, ...ports.map(String)], { timeout: 15_000, windowsHide: true });
  return r.status === 0;
}

/**
 * Asignación de un rango CONTIGUO de `count` puertos a una tarea, bajo lock (D-08, FR-TK-09 y
 * FR-TK-14). Reserva el bloque en `ports.json` antes de comprobarlo: así dos tareas que piden a la
 * vez no reciben el mismo rango. Si algún puerto del bloque está ocupado fuera de Silka, el bloque
 * se libera y se busca el siguiente.
 */
export function allocatePorts(repoRoot, taskId, count, { probe = portsAreFree } = {}) {
  if (!count) return [];
  for (let round = 0; round < MAX_PROBE_ROUNDS; round += 1) {
    const block = withFileLock(portsLock(repoRoot), () => {
      const data = readPorts(repoRoot);
      data.allocated = data.allocated || {};
      const used = new Set(Object.values(data.allocated).flat());
      let start = Number(data.next) || FIRST_PORT;
      if (start < FIRST_PORT || start > LAST_PORT) start = FIRST_PORT;
      let found = null;
      for (let attempt = 0; attempt < 2 && !found; attempt += 1) {
        let run = [];
        let cursor = attempt === 0 ? start : FIRST_PORT;
        const limit = attempt === 0 ? LAST_PORT : start;
        for (; cursor < limit; cursor += 1) {
          if (used.has(cursor)) { run = []; continue; }
          run.push(cursor);
          if (run.length === count) { found = run; break; }
        }
      }
      if (!found) throw new Error('No pude asignar los puertos pedidos');
      data.allocated[taskId] = found;
      data.next = found[found.length - 1] + 1;
      writePorts(repoRoot, data);
      return found;
    });
    if (probe(block)) return block;
    // Ocupado fuera de Silka: se suelta el bloque y se sigue buscando después de él.
    withFileLock(portsLock(repoRoot), () => {
      const data = readPorts(repoRoot);
      if (data.allocated?.[taskId]) delete data.allocated[taskId];
      data.next = block[block.length - 1] + 1;
      writePorts(repoRoot, data);
    });
  }
  throw new Error(`No encontré un rango libre de ${count} puertos tras ${MAX_PROBE_ROUNDS} intentos`);
}

export function releasePorts(repoRoot, taskId) {
  withFileLock(portsLock(repoRoot), () => {
    const data = readPorts(repoRoot);
    if (!data.allocated?.[taskId]) return;
    delete data.allocated[taskId];
    writePorts(repoRoot, data);
  });
}

export function portsEnv(ports) {
  const env = {};
  (ports || []).forEach((p, i) => {
    env[`SILKA_PORT_${i + 1}`] = String(p);
  });
  return env;
}