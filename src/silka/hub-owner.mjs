// BUG-04: un solo hub por puerto. Tras reiniciar el equipo, cada cliente (bridges, TUI) veía "no
// hay hub" a la vez y levantaba el suyo: quedaban varios `silka hub` vivos y los supervisores de
// todos competían (rompe el invariante de un solo escritor, I-6).
// - Dueño registrado: <config>/hub-<puerto>.owner.json con pid y hora de inicio del proceso (la
//   hora distingue al dueño de otro proceso que reutilice su pid).
// - Candado de arranque: reclamar el dueño y decidir si lanzar un hub se hace bajo un mismo
//   candado de archivo, así dos procesos nunca deciden a la vez.
import fs from 'node:fs';
import path from 'node:path';
import { readProcessStartMs, withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';

const ownStartedAt = Math.round(Date.now() - process.uptime() * 1000);
/** Un hub recién lanzado tiene este plazo para registrarse antes de que otro cliente lance otro. */
export const SPAWN_GRACE_MS = 20_000;

export function hubOwnerPath(port) {
  return path.join(silkaConfigDir(), `hub-${port}.owner.json`);
}

function hubLockPath(port) {
  return path.join(silkaConfigDir(), `hub-${port}.lock`);
}

function spawnMarkerPath(port) {
  return path.join(silkaConfigDir(), `hub-${port}.spawning.json`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readHubOwner(port) {
  const owner = readJson(hubOwnerPath(port));
  return owner && Number.isInteger(owner.pid) ? owner : null;
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

/** ¿Sigue vivo el proceso dueño? Mismo pid y misma hora de inicio (contra reuso de pid). */
export function hubOwnerAlive(owner, { startOf = readProcessStartMs } = {}) {
  if (!owner || !pidAlive(owner.pid)) return false;
  if (owner.pid === process.pid) return Math.abs(ownStartedAt - Number(owner.startedAt)) < 5000;
  const live = startOf(owner.pid);
  if (!Number.isFinite(live) || !Number.isFinite(Number(owner.startedAt))) return true;
  return Math.abs(live - Number(owner.startedAt)) < 5000;
}

/**
 * Reclama ser el hub de este puerto. Devuelve { ok: true } o { ok: false, owner } si otro hub vivo
 * ya lo es. Un hub que no consigue el puerto no arranca supervisores.
 */
export function claimHubOwnership(port) {
  return withFileLock(hubLockPath(port), () => {
    const owner = readHubOwner(port);
    if (owner && owner.pid !== process.pid && hubOwnerAlive(owner)) return { ok: false, owner };
    writeAtomic(hubOwnerPath(port), `${JSON.stringify({
      pid: process.pid,
      startedAt: ownStartedAt,
      port,
      since: new Date().toISOString(),
    })}\n`);
    try { fs.rmSync(spawnMarkerPath(port), { force: true }); } catch { /* no estaba */ }
    return { ok: true };
  });
}

/** Suelta el registro solo si sigue siendo nuestro (síncrono: sirve en process.on('exit')). */
export function releaseHubOwnership(port) {
  try {
    const owner = readHubOwner(port);
    if (owner?.pid === process.pid) fs.rmSync(hubOwnerPath(port), { force: true });
  } catch { /* el siguiente hub verá el pid muerto */ }
}

/**
 * Decide, bajo el candado, si este cliente debe lanzar un hub. No lo lanza si ya hay uno vivo
 * (`isAlive`), si hay un dueño registrado vivo (está arrancando) o si otro cliente lanzó uno hace
 * menos de SPAWN_GRACE_MS. Si decide que sí, deja la marca para que los demás esperen.
 */
export function shouldSpawnHub(port, { isAlive = () => false, now = Date.now } = {}) {
  return withFileLock(hubLockPath(port), () => {
    if (isAlive()) return false;
    const owner = readHubOwner(port);
    if (owner && hubOwnerAlive(owner)) return false;
    const marker = readJson(spawnMarkerPath(port));
    if (marker && now() - Number(marker.at) < SPAWN_GRACE_MS) return false;
    writeAtomic(spawnMarkerPath(port), `${JSON.stringify({ at: now(), pid: process.pid })}\n`);
    return true;
  });
}
