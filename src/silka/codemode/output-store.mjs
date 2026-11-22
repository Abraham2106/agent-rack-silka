import crypto from 'node:crypto';
import { silkaError } from './errors.mjs';
import { OUTPUT_INLINE_MAX_BYTES, OUTPUT_PREVIEW_CHARS } from './limits.mjs';

const store = new Map();

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

export function resetOutputStore() {
  store.clear();
}

export function storeExecutionResult(value) {
  const text = JSON.stringify(value);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= OUTPUT_INLINE_MAX_BYTES) return value;
  const id = newId();
  store.set(id, text);
  return {
    ref: `out:${id}`,
    bytes,
    preview: text.slice(0, OUTPUT_PREVIEW_CHARS),
  };
}

/** SEC-05: solo refs opacas emitidas aquí (`out:<id>`). */
export function getStoredRef(ref) {
  const raw = String(ref ?? '');
  if (!raw.startsWith('out:')) {
    throw silkaError('E_NOT_FOUND', `Referencia no válida: solo se admiten ids out:<id> emitidos por Silka.`);
  }
  const id = raw.slice(4);
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw silkaError('E_NOT_FOUND', 'Referencia out: mal formada.');
  }
  const text = store.get(id);
  if (text == null) throw silkaError('E_NOT_FOUND', `No hay salida para ${raw}.`);
  return JSON.parse(text);
}

export function outputStoreSize() {
  return store.size;
}