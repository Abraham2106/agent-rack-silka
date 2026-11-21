import { pidAlive } from '../hub.mjs';
import { readJsonRetry, readProcessStartMs, withFileLock, writeAtomic } from '../lock.mjs';
import { silkaError } from '../codemode/errors.mjs';
import { mergeOwnerPath } from './paths.mjs';

function selfProcessStartMs() {
  return Math.round(Date.now() - process.uptime() * 1000);
}

function ownerAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  if (!pidAlive(owner.pid)) return false;
  if (owner.pid === process.pid) return true;
  if (Number.isFinite(owner.startedAt) && owner.startedAt > 0) {
    const live = readProcessStartMs(owner.pid);
    if (Number.isFinite(live) && Math.abs(live - owner.startedAt) > 1500) return false;
  }
  return true;
}

export function readMergeOwner(repoRoot) {
  return readJsonRetry(mergeOwnerPath(repoRoot), { fallback: null });
}

function withOwnerLock(repoRoot, fn) {
  return withFileLock(`${mergeOwnerPath(repoRoot)}.lock`, fn);
}

/** Toma o renueva el lease del escritor único de mezcla (FR-MQ-01). */
export function claimMergeLease(repoRoot, { pid = process.pid, startedAt } = {}) {
  let result = { ok: false, fencingToken: 0, owner: null };
  withOwnerLock(repoRoot, () => {
    const cur = readMergeOwner(repoRoot);
    const started = Number.isFinite(startedAt) ? startedAt : selfProcessStartMs();
    if (cur && ownerAlive(cur) && cur.pid !== pid) {
      result = { ok: false, fencingToken: cur.fencingToken, owner: cur };
      return;
    }
    const fencingToken = cur && ownerAlive(cur) && cur.pid === pid
      ? cur.fencingToken
      : (Number(cur?.fencingToken) || 0) + 1;
    const next = {
      pid,
      startedAt: started,
      fencingToken,
      renewedAt: new Date().toISOString(),
    };
    writeAtomic(mergeOwnerPath(repoRoot), `${JSON.stringify(next)}\n`);
    result = { ok: true, fencingToken, owner: next };
  });
  return result;
}

export function assertFencing(repoRoot, fencingToken) {
  const cur = readMergeOwner(repoRoot);
  if (!cur || cur.fencingToken !== fencingToken || !ownerAlive(cur)) {
    throw silkaError('E_FENCING', 'Token de mezcla no vigente.');
  }
}