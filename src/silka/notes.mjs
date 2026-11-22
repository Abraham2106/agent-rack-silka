import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';

/** Notas por sesión: un archivo por sesión, así dos sesiones no se bloquean entre sí (FR-SN-01). */
export const NOTE_PAGE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export function notesDir() {
  return path.join(silkaConfigDir(), 'notes');
}

/** Archivo global de antes de FR-SN-01; solo lo lee la migración. */
export function legacyNotesFile() {
  return path.join(silkaConfigDir(), 'notes.jsonl');
}

function fileKey(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_');
}

function sessionFile(sessionId) {
  return path.join(notesDir(), `${fileKey(sessionId)}.jsonl`);
}

function sessionLock(file) {
  return file.replace(/\.jsonl$/, '.lock');
}

function listFiles() {
  try {
    return fs.readdirSync(notesDir()).filter((name) => name.endsWith('.jsonl')).map((name) => path.join(notesDir(), name));
  } catch {
    return [];
  }
}

function parseLines(text) {
  return String(text).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const note = JSON.parse(line);
      return note && typeof note === 'object' ? [note] : [];
    } catch {
      return [];
    }
  });
}

function readFile(file) {
  try {
    return parseLines(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeFile(file, notes) {
  const body = notes.map((note) => JSON.stringify(note)).join('\n');
  writeAtomic(file, body ? `${body}\n` : '');
}

/** Archivos de sesión que casan con el id (exacto o por prefijo, como antes). */
function matchFiles(sessionId) {
  if (!sessionId) return listFiles();
  const key = fileKey(sessionId);
  const all = listFiles();
  const exact = all.find((file) => path.basename(file, '.jsonl') === key);
  return exact ? [exact] : all.filter((file) => path.basename(file, '.jsonl').startsWith(key));
}

export function appendNote({ sessionId, text, kind, workspace }) {
  const note = {
    id: crypto.randomUUID(),
    sessionId: String(sessionId),
    text: String(text),
    at: new Date().toISOString(),
    read: false,
  };
  if (kind) note.kind = String(kind);
  if (workspace) note.workspace = String(workspace);
  const file = sessionFile(sessionId);
  return withFileLock(sessionLock(file), () => {
    const notes = readFile(file);
    notes.push(note);
    writeFile(file, notes);
    return note;
  });
}

/**
 * Respuesta de silka_notes para una sesión: como máximo NOTE_PAGE notas sin leer
 * (las más recientes) y el número de las que quedan fuera. Con markRead solo se
 * marcan como leídas las que se devuelven; las demás siguen sin leer.
 */
export function managerNotes({ sessionId, markRead = true, limit = NOTE_PAGE } = {}) {
  const files = matchFiles(sessionId);
  if (files.length !== 1) {
    return { sessionId: sessionId ? String(sessionId) : null, notes: [], omitted: 0, ambiguous: files.length > 1 };
  }
  const file = files[0];
  return withFileLock(sessionLock(file), () => {
    const notes = readFile(file);
    const pending = notes.filter((note) => note.read === false);
    const shown = pending.slice(-limit);
    const omitted = pending.length - shown.length;
    if (markRead && shown.length) {
      const ids = new Set(shown.map((note) => note.id));
      writeFile(file, notes.map((note) => (ids.has(note.id) ? { ...note, read: true } : note)));
    }
    const result = {
      sessionId: notes[0]?.sessionId ?? path.basename(file, '.jsonl'),
      notes: shown,
      omitted,
    };
    if (omitted) result.hint = `Hay ${omitted} notas más sin leer; llama otra vez con sessionId para verlas.`;
    return result;
  });
}

/** Conteos por sesión (total y sin leer), nunca el texto de las notas (FR-SN-02). */
export function notesSummary() {
  const sessions = listFiles().map((file) => {
    const notes = readFile(file);
    return {
      sessionId: notes[0]?.sessionId ?? path.basename(file, '.jsonl'),
      total: notes.length,
      unread: notes.filter((note) => note.read === false).length,
    };
  }).filter((row) => row.total > 0);
  return { sessions, hint: 'Pide las notas de una sesión con sessionId.' };
}

/** Notas con read:false de todas las sesiones (o de una). Con markRead las marca. */
export function unreadNotes({ sessionId, markRead = true } = {}) {
  const pending = [];
  for (const file of matchFiles(sessionId)) {
    withFileLock(sessionLock(file), () => {
      const notes = readFile(file);
      const unread = notes.filter((note) => note.read === false);
      if (!unread.length) return;
      pending.push(...unread);
      if (markRead) {
        const ids = new Set(unread.map((note) => note.id));
        writeFile(file, notes.map((note) => (ids.has(note.id) ? { ...note, read: true } : note)));
      }
    });
  }
  return pending;
}

function sameWorkspace(a, b) {
  if (!a || !b) return false;
  const norm = (value) => path.resolve(String(value)).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function allNotes() {
  return listFiles().flatMap((file) => readFile(file));
}

/** Inserciones del usuario en un workspace, las más nuevas al final. */
export function recentInsertions(workspace, sinceMs = 2 * 60 * 60 * 1000) {
  const cutoff = Date.now() - sinceMs;
  return allNotes().filter((note) => {
    if (note.kind !== 'insertion' || !note.workspace) return false;
    if (workspace && !sameWorkspace(note.workspace, workspace)) return false;
    const at = Date.parse(note.at);
    return Number.isFinite(at) && at >= cutoff;
  });
}

export function unreadSessionIds() {
  return new Set(allNotes().filter((note) => note.read === false && note.sessionId).map((note) => note.sessionId));
}

/** Borra las notas de una sesión (tarea mezclada o descartada). */
export function deleteSessionNotes(sessionId) {
  for (const file of matchFiles(sessionId).filter((f) => path.basename(f, '.jsonl') === fileKey(sessionId))) {
    withFileLock(sessionLock(file), () => {
      fs.rmSync(file, { force: true });
    });
  }
}

/**
 * Volátiles (FR-SN-03). `sessions` es la lista del hub; si no es un array no se
 * borra nada. `closedSessionIds` son sesiones cuyas tareas se mezclaron o descartaron.
 */
export function pruneNotes({ sessions, closedSessionIds = [], now = Date.now() } = {}) {
  if (!Array.isArray(sessions)) return { removed: 0 };
  const live = new Map(sessions.filter((s) => s?.sessionId).map((s) => [fileKey(s.sessionId), s]));
  const closed = new Set([...closedSessionIds].map(fileKey));
  let removed = 0;
  for (const file of listFiles()) {
    const key = path.basename(file, '.jsonl');
    withFileLock(sessionLock(file), () => {
      const notes = readFile(file);
      const unread = notes.filter((note) => note.read === false).length;
      const session = live.get(key);
      let drop = false;
      if (closed.has(key)) drop = true;
      else if (session) drop = session.status === 'cancelled' && unread === 0;
      else if (unread === 0) drop = true;
      else {
        let mtime = now;
        try { mtime = fs.statSync(file).mtimeMs; } catch { /* sin archivo no hay nada que borrar */ }
        drop = now - mtime > DAY_MS;
      }
      if (drop) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    });
  }
  return { removed };
}

/**
 * Migración única de notes.jsonl (FR-SN-01): reparte las notas por sesión,
 * descarta los avisos de conflicto (ahora son estado) y las de sesiones que ya
 * no existen. El archivo global se renombra para no volver a migrarlo.
 */
export function migrateLegacyNotes({ liveSessionIds } = {}) {
  const legacy = legacyNotesFile();
  if (!fs.existsSync(legacy)) return { migrated: 0, discarded: 0 };
  const live = liveSessionIds ? new Set([...liveSessionIds].map(String)) : null;
  return withFileLock(path.join(silkaConfigDir(), 'notes-migrate.lock'), () => {
    if (!fs.existsSync(legacy)) return { migrated: 0, discarded: 0 };
    const notes = readFile(legacy);
    const groups = new Map();
    let discarded = 0;
    for (const note of notes) {
      const sid = String(note.sessionId ?? '');
      const conflict = String(note.text ?? '').startsWith('Conflicto:');
      if (!sid || sid === 'manager' || conflict || (live && !live.has(sid))) {
        discarded += 1;
        continue;
      }
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push(note);
    }
    let migrated = 0;
    for (const [sid, batch] of groups) {
      const file = sessionFile(sid);
      withFileLock(sessionLock(file), () => {
        const existing = readFile(file);
        const seen = new Set(existing.map((note) => note.id));
        const merged = [...existing, ...batch.filter((note) => !seen.has(note.id))];
        migrated += merged.length - existing.length;
        writeFile(file, merged);
      });
    }
    fs.renameSync(legacy, `${legacy}.migrado`);
    return { migrated, discarded };
  });
}
