// Lanzador de setup y verify en proceso aparte (BUG-11). El supervisor del hub ya no ejecuta
// comandos de la tarea dentro de su ciclo: lanza job-worker.mjs, sigue con lo demás y en ciclos
// siguientes ve el resultado en el store. Así el ciclo dura milisegundos aunque el verify tarde
// minutos, y el vigilante de 2 min (ciclo colgado) no lo confunde con un cuelgue.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidAlive } from '../hub.mjs';
import { readProcessStartMs } from '../lock.mjs';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'job-worker.mjs');
/** Un trabajo que pasa de esto se mata: cada comando ya tiene su propio tope (verifyTimeoutMs). */
const JOB_MAX_MS = 30 * 60_000;
/** Reintentos de un trabajo cuyo proceso murió sin dejar resultado. */
const MAX_ATTEMPTS = 3;

const keyOf = (repoRoot, taskId) => `${path.resolve(repoRoot).toLowerCase()}|${taskId}`;

export function createJobRunner({ log = () => {}, maxMs = JOB_MAX_MS, workerPath = WORKER } = {}) {
  const running = new Map();
  const attempts = new Map();
  // Caché del chequeo de pid + hora de inicio (en Windows cuesta lanzar PowerShell).
  const ownerChecked = new Map();

  /** ¿Sigue vivo el proceso que el store dice que está trabajando? (p. ej. tras reiniciar el hub) */
  function storedJobAlive(job) {
    if (!job || !Number.isInteger(job.pid) || !pidAlive(job.pid)) return false;
    const cacheKey = `${job.pid}:${job.startedAt}`;
    if (!ownerChecked.has(cacheKey)) {
      const live = readProcessStartMs(job.pid);
      // Sin dato de hora de inicio se confía en el pid; con dato, debe coincidir (contra reuso de pid).
      ownerChecked.set(cacheKey, !Number.isFinite(live) || !Number.isFinite(job.startedAt) || Math.abs(live - job.startedAt) < 1500);
    }
    return ownerChecked.get(cacheKey);
  }

  function busy(repoRoot, task) {
    if (running.has(keyOf(repoRoot, task.id))) return true;
    return storedJobAlive(task.job);
  }

  function start(kind, repoRoot, taskId) {
    const key = keyOf(repoRoot, taskId);
    if (running.has(key)) return false;
    const n = (attempts.get(`${key}|${kind}`) || 0) + 1;
    if (n > MAX_ATTEMPTS) return false;
    attempts.set(`${key}|${kind}`, n);
    const child = spawn(process.execPath, [workerPath, kind, repoRoot, taskId], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const timer = setTimeout(() => {
      log(`[silka] ${kind} de ${taskId} pasó de ${Math.round(maxMs / 60_000)} min; se corta.`);
      try { child.kill(); } catch { /* ya terminó */ }
    }, maxMs);
    timer.unref?.();
    const done = new Promise((resolve) => {
      const finish = (code) => {
        clearTimeout(timer);
        running.delete(key);
        if (code === 0) attempts.delete(`${key}|${kind}`);
        else {
          const last = n >= MAX_ATTEMPTS ? ' No se reintenta más.' : '';
          log(`[silka] ${kind} de ${taskId} terminó con error (código ${code}).${last} ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
        }
        resolve(code);
      };
      child.once('exit', (code) => finish(code ?? 1));
      child.once('error', (err) => { log(`[silka] no se pudo lanzar ${kind} de ${taskId}: ${err.message}`); finish(1); });
    });
    running.set(key, { kind, child, startedAt: Date.now(), done });
    log(`[silka] ${kind} de ${taskId} en proceso aparte (pid ${child.pid}).`);
    return true;
  }

  return {
    busy,
    start,
    get size() { return running.size; },
    /** Espera a que terminen los trabajos en curso (pruebas y cierre ordenado). */
    async idle() {
      while (running.size) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([...running.values()].map((j) => j.done));
      }
    },
  };
}
