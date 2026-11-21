import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { tasksRoot } from './store.mjs';

export function logRef(taskId, tag = 'verify') {
  return `log:${taskId}#${tag}`;
}

function logPath(repoRoot, taskId, tag) {
  return path.join(tasksRoot(repoRoot), 'logs', `${taskId}-${tag}.log`);
}

export function writeTaskLog(repoRoot, taskId, tag, body) {
  const file = logPath(repoRoot, taskId, tag);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(body ?? ''));
  return logRef(taskId, tag);
}

export function readTaskLogRef(ref, repoRoot) {
  const raw = String(ref ?? '');
  const m = /^log:([^#]+)#(.+)$/.exec(raw);
  if (!m) {
    throw silkaError('E_NOT_FOUND', `Referencia de log no válida: ${raw}`);
  }
  const file = logPath(repoRoot, m[1], m[2]);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw silkaError('E_NOT_FOUND', `No hay log para ${raw}.`);
  }
}