import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonRetry, withFileLock, writeAtomic } from '../lock.mjs';

export function tasksRoot(repoRoot) {
  return path.join(repoRoot, '.silka', 'tasks-v1');
}

function storeFile(repoRoot) {
  return path.join(tasksRoot(repoRoot), 'tasks.json');
}

function lockFile(repoRoot) {
  return path.join(tasksRoot(repoRoot), 'tasks.lock');
}

export function newTaskId() {
  return `tk-${crypto.randomBytes(4).toString('hex')}`;
}

export function readTaskStore(repoRoot) {
  const file = storeFile(repoRoot);
  const parsed = readJsonRetry(file, { retries: 1, fallback: null });
  if (!parsed || typeof parsed !== 'object') {
    return { version: 1, tasks: [], maxConcurrentTasks: 5 };
  }
  return {
    version: Number(parsed.version) || 1,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    maxConcurrentTasks: Number(parsed.maxConcurrentTasks) > 0 ? Number(parsed.maxConcurrentTasks) : 5,
  };
}

export function writeTaskStore(repoRoot, store) {
  writeAtomic(storeFile(repoRoot), `${JSON.stringify(store, null, 2)}\n`);
}

export function withTaskStore(repoRoot, fn) {
  return withFileLock(lockFile(repoRoot), () => fn(readTaskStore(repoRoot)));
}

export function mutateTaskStore(repoRoot, mutator) {
  return withFileLock(lockFile(repoRoot), () => {
    const store = readTaskStore(repoRoot);
    const next = mutator(store) ?? store;
    writeTaskStore(repoRoot, next);
    return next;
  });
}

export function getTask(repoRoot, id) {
  const store = readTaskStore(repoRoot);
  return store.tasks.find((t) => t.id === id) || null;
}