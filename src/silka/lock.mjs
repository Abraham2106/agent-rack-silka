import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* espera corta */ }
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

// Hora de inicio propia sin lanzar procesos (PowerShell tarda ~0,5 s y bajo carga caduca).
// Se calcula una vez; la diferencia con la que reporta el SO es de milisegundos.
const ownStartedAt = Math.round(Date.now() - process.uptime() * 1000);
function selfProcessStartMs() {
  return ownStartedAt;
}

/** Hora de inicio del proceso en ms unix (epoch). */
export function readProcessStartMs(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (process.platform === 'win32') {
    // DateTimeOffset y no [datetime]'1970-01-01Z': ese literal se lee en hora local y el resultado
    // salía corrido por el huso horario (6 h en UTC-6); todo pid vivo parecía "reusado".
    const script = `([DateTimeOffset](Get-Process -Id ${id} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8_000,
    });
    const n = Number(String(r.stdout || '').trim());
    return Number.isFinite(n) ? n : null;
  }
  try {
    const txt = fs.readFileSync(`/proc/${id}/stat`, 'utf8');
    const close = txt.lastIndexOf(')');
    const rest = close >= 0 ? txt.slice(close + 2).split(' ') : [];
    const startTicks = Number(rest[19]);
    const uptimeSec = Number(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    if (!Number.isFinite(startTicks) || !Number.isFinite(uptimeSec)) return null;
    const hz = 100;
    const boot = Date.now() - uptimeSec * 1000;
    return boot + Math.floor((startTicks / hz) * 1000);
  } catch {
    const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(id)], { encoding: 'utf8', timeout: 5_000 });
    const raw = String(r.stdout || '').trim();
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
}

/**
 * Foto del lock. `null` solo si no existe. Un lock que existe pero aún no tiene
 * contenido legible (su dueño acaba de crearlo y no ha escrito el pid) NO es
 * "muerto": se marca `partial` y solo caduca por antigüedad.
 */
function readLockSnapshot(lockPath) {
  let stat;
  try { stat = fs.statSync(lockPath); } catch { return null; }
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return { pid: Number(parsed?.pid), startedAt: Number(parsed?.startedAt), mtimeMs: stat.mtimeMs, partial: false };
  } catch {
    return { pid: NaN, startedAt: NaN, mtimeMs: stat.mtimeMs, partial: true };
  }
}

/** Misma instancia de lock: mismo dueño y mismo mtime (un lock nuevo nunca coincide). */
function snapshotsMatch(left, right) {
  if (!left || !right) return false;
  return Object.is(left.pid, right.pid) && Object.is(left.startedAt, right.startedAt) && left.mtimeMs === right.mtimeMs;
}

/** ¿El dueño de ESTA foto está muerto? Se decide sobre la foto, no releyendo el archivo. */
function snapshotDead(snap) {
  if (!snap) return false;
  // Un dueño vivo renueva el mtime cada segundo: un lock reciente está vivo, sin más
  // comprobaciones. Solo un lock que dejó de renovarse se examina (PID y hora de inicio).
  const stale = Date.now() - snap.mtimeMs > 8000;
  if (!stale) return false;
  if (snap.partial || !Number.isInteger(snap.pid) || snap.pid <= 0) return stale;
  if (!pidAlive(snap.pid)) return true;
  if (!Number.isFinite(snap.startedAt) || snap.startedAt <= 0) return stale;
  const liveStart = readProcessStartMs(snap.pid);
  return Number.isFinite(liveStart) && Math.abs(liveStart - snap.startedAt) > 1500;
}

/**
 * Rompe un lock rancio sin carreras (C-01).
 * Renombrar y "devolver" el lock deja una ventana en la que un tercero lo crea y la
 * devolución lo pisa. En su lugar, un lock rompedor corto (`<lock>.break`, creado con
 * `wx`, atómico) garantiza que solo un proceso rompe a la vez, y ese proceso solo borra
 * si el lock sigue siendo EXACTAMENTE la instancia muerta que vio (mismo dueño y mtime).
 * Devuelve true si borró el lock rancio (el llamador reintenta crearlo con `wx`).
 */
export function tryClaimStaleLock(lockPath, seen) {
  const breaker = `${lockPath}.break`;
  let fd;
  try {
    fd = fs.openSync(breaker, 'wx');
  } catch (err) {
    if (err?.code !== 'EEXIST') return false;
    // Un rompedor que murió a mitad deja el archivo: caduca a los 5 s (romper dura ms).
    try {
      if (Date.now() - fs.statSync(breaker).mtimeMs > 5000) fs.rmSync(breaker, { force: true });
    } catch { /* ya no está */ }
    return false;
  }
  try {
    const now = readLockSnapshot(lockPath);
    if (!snapshotsMatch(now, seen) || !snapshotDead(now)) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.closeSync(fd); } catch { /* cerrado */ }
    try { fs.rmSync(breaker, { force: true }); } catch { /* ya no está */ }
  }
}

/** El lock se puede tomar si el dueño ya no existe o reutilizó su PID (C-03). */
export function lockHolderDead(lockPath) {
  return snapshotDead(readLockSnapshot(lockPath));
}

/**
 * Lock exclusivo. Si no se consigue, lanza: no sigue sin él.
 * El dueño renueva el mtime mientras trabaja.
 */
export function withFileLock(lockPath, fn, { timeoutMs = 20_000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const start = Date.now();
  let fd;
  while (fd === undefined && Date.now() - start < timeoutMs) {
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (err) {
      // En Windows, un lock recién borrado mientras otro lo leía queda "pendiente de borrar"
      // y crear uno nuevo da EPERM/EBUSY por un instante: es transitorio, se reintenta.
      if (err?.code === 'EPERM' || err?.code === 'EBUSY') { sleepMs(15); continue; }
      if (err?.code !== 'EEXIST') throw err;
      // Una sola foto: se decide "muerto" y se roba sobre la MISMA instancia (C-01).
      const seen = readLockSnapshot(lockPath);
      if (snapshotDead(seen) && tryClaimStaleLock(lockPath, seen)) continue;
      sleepMs(25);
    }
  }
  if (fd === undefined) throw new Error(`No pude tomar el lock ${lockPath}`);
  const startedAt = selfProcessStartMs();
  // Nunca un dato inventado: si no hay hora de inicio, se omite y manda la antigüedad del mtime.
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Number.isFinite(startedAt) ? startedAt : null }));
  const timer = setInterval(() => {
    try {
      const now = new Date();
      fs.futimesSync(fd, now, now);
    } catch { /* el lock sigue */ }
  }, 1000);
  timer.unref?.();
  try {
    return fn();
  } finally {
    clearInterval(timer);
    try { fs.closeSync(fd); } catch { /* ya cerrado */ }
    // Soltar con reintentos: si un lector lo tiene abierto en Windows, el borrado puede fallar
    // un instante; dejarlo puesto obligaría a los demás a esperar a que caduque (8 s).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { fs.rmSync(lockPath, { force: true }); break; } catch { sleepMs(10 * (attempt + 1)); }
    }
  }
}

/**
 * Lee JSON con un reintento si el archivo falta (rename en curso, C-02 / I-7).
 */
export function readJsonRetry(file, { retries = 1, fallback = null, parse = JSON.parse } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (!fs.existsSync(file)) {
        if (attempt < retries) {
          sleepMs(12);
          continue;
        }
        return fallback;
      }
      return parse(fs.readFileSync(file, 'utf8'));
    } catch {
      if (attempt < retries) {
        sleepMs(12);
        continue;
      }
      return fallback;
    }
  }
  return fallback;
}

/** Escribe a un temporal y lo renombra, con reintento (Windows reemplaza sin borrar antes, C-02). */
export function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body);
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      last = err;
      if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
        sleepMs(20 * (attempt + 1));
        continue;
      }
      sleepMs(20 * (attempt + 1));
    }
  }
  try {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  } catch (err) {
    throw last || err;
  }
}