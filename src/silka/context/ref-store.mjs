import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { redactSecrets } from '../redact.mjs';
import { writeAtomic } from '../lock.mjs';
import { contextRefsDir } from './paths.mjs';

const mem = new Map();

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

export function resetContextRefStore() {
  mem.clear();
}

function refFile(workspace, id) {
  return path.join(contextRefsDir(workspace), `${id}.txt`);
}

/** SEC-05: ids opacos ctx:<id> emitidos aquí. */
export function storeContextBody(workspace, body) {
  const text = redactSecrets(String(body ?? ''));
  const id = newId();
  const ws = workspace ? path.resolve(workspace) : '';
  if (ws) {
    const file = refFile(ws, id);
    writeAtomic(file, text);
  } else {
    mem.set(id, text);
  }
  return {
    ref: `ctx:${id}`,
    bytes: Buffer.byteLength(text, 'utf8'),
    preview: text.slice(0, 240),
  };
}

export function getContextRef(ref, workspace) {
  const raw = String(ref ?? '');
  if (!raw.startsWith('ctx:')) {
    throw silkaError('E_NOT_FOUND', `Referencia no válida: solo ctx:<id> emitidos por Silka.`);
  }
  const id = raw.slice(4);
  if (!id || /[/\\.]/.test(id)) {
    throw silkaError('E_NOT_FOUND', 'Referencia ctx: mal formada.');
  }
  if (mem.has(id)) return mem.get(id);
  const ws = workspace ? path.resolve(workspace) : '';
  if (!ws) throw silkaError('E_NOT_FOUND', `No hay contexto para ${raw}.`);
  const file = refFile(ws, id);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw silkaError('E_NOT_FOUND', `No hay contexto para ${raw}.`);
  }
}