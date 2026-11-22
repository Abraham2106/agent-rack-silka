import path from 'node:path';
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

/** Asignación bajo lock (D-08, FR-TK-09). */
export function allocatePorts(repoRoot, taskId, count) {
  if (!count) return [];
  return withFileLock(portsLock(repoRoot), () => {
    const data = readPorts(repoRoot);
    const used = new Set(Object.values(data.allocated || {}).flat());
    let cursor = Number(data.next) || 19000;
    const picked = [];
    while (picked.length < count && cursor < 65500) {
      if (!used.has(cursor)) {
        picked.push(cursor);
        used.add(cursor);
      }
      cursor += 1;
    }
    if (picked.length < count) throw new Error('No pude asignar los puertos pedidos');
    data.allocated = data.allocated || {};
    data.allocated[taskId] = picked;
    data.next = cursor;
    writePorts(repoRoot, data);
    return picked;
  });
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