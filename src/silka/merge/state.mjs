import fs from 'node:fs';
import { readJsonRetry, writeAtomic } from '../lock.mjs';
import { mergeStatePath } from './paths.mjs';

export function readMergeRuntime(repoRoot) {
  return readJsonRetry(mergeStatePath(repoRoot), { fallback: null });
}

export function writeMergeRuntime(repoRoot, row) {
  writeAtomic(mergeStatePath(repoRoot), `${JSON.stringify(row)}\n`);
}

export function clearMergeRuntime(repoRoot) {
  try { fs.rmSync(mergeStatePath(repoRoot), { force: true }); } catch { /* ya no está */ }
}