// Repos donde Silka lanzó tareas. Los supervisores del hub (tareas y cola de mezcla)
// vigilan todos estos, no solo el repo de Silka: antes, una tarea lanzada en otro
// proyecto nunca se verificaba ni recibía ficha.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withFileLock, writeAtomic } from '../lock.mjs';
import { silkaConfigDir } from '../paths.mjs';

function registryPath() {
  return path.join(silkaConfigDir(), 'task-repos.json');
}

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    return Array.isArray(parsed?.repos) ? parsed.repos.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

const norm = (p) => path.resolve(p).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

/** Repos bajo la carpeta temporal del sistema: solo se registran si la configuración también es temporal (pruebas). */
function isTempRepo(repoRoot) {
  const tmp = norm(os.tmpdir());
  return norm(repoRoot).startsWith(`${tmp}/`) && !norm(silkaConfigDir()).startsWith(`${tmp}/`);
}

export function registerTaskRepo(repoRoot) {
  if (!repoRoot) return;
  // Segunda barrera (BUG-01): un proceso de prueba sin config aislada no ensucia el registro real.
  if (isTempRepo(repoRoot)) return;
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  withFileLock(`${file}.lock`, () => {
    const repos = readRaw();
    if (repos.some((r) => norm(r) === norm(repoRoot))) return;
    repos.push(path.resolve(repoRoot));
    writeAtomic(file, `${JSON.stringify({ repos }, null, 2)}\n`);
  });
}

/** Repos registrados que siguen existiendo (los borrados, p. ej. temporales de pruebas, se omiten). */
export function listTaskRepos() {
  return readRaw().filter((repo) => {
    if (isTempRepo(repo)) return false;
    try {
      return fs.existsSync(path.join(repo, '.silka', 'tasks-v1'));
    } catch {
      return false;
    }
  });
}
