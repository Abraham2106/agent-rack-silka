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

/** El lock se puede tomar si el dueño ya no existe. Un pid vivo no se roba. */
function lockHolderDead(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pid = Number(parsed?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return Date.now() - fs.statSync(lockPath).mtimeMs > 8000;
    }
    return !pidAlive(pid);
  } catch {
    return true;
  }
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
      if (err?.code !== 'EEXIST') throw err;
      if (lockHolderDead(lockPath)) {
        try { fs.rmSync(lockPath, { force: true }); } catch { /* otro proceso lo soltó */ }
        continue;
      }
      sleepMs(25);
    }
  }
  if (fd === undefined) throw new Error(`No pude tomar el lock ${lockPath}`);
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
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
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ya no está */ }
  }
}

/** Escribe a un temporal y lo renombra, con reintento (Windows no renombra encima). */
export function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body);
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      last = err;
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
