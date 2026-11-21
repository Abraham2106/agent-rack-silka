import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';

export function notesFile() {
  return path.join(silkaConfigDir(), 'notes.jsonl');
}

function notesLock() {
  return path.join(silkaConfigDir(), 'notes.lock');
}

function readNotes() {
  try {
    return fs.readFileSync(notesFile(), 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const note = JSON.parse(line);
        return note && typeof note === 'object' ? [note] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function writeNotes(notes) {
  const body = notes.map((note) => JSON.stringify(note)).join('\n');
  writeAtomic(notesFile(), body ? `${body}\n` : '');
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
  return withFileLock(notesLock(), () => {
    const notes = readNotes();
    notes.push(note);
    writeNotes(notes);
    return note;
  });
}

function matchesSession(note, sessionId) {
  if (!sessionId) return true;
  const id = String(note.sessionId ?? '');
  return id === sessionId || id.startsWith(sessionId);
}

/** Notas con read:false. Con markRead las marca y las reescribe. */
export function unreadNotes({ sessionId, markRead = true } = {}) {
  return withFileLock(notesLock(), () => {
    const notes = readNotes();
    const pending = notes.filter((note) => note.read === false && matchesSession(note, sessionId));
    if (markRead && pending.length) {
      const ids = new Set(pending.map((note) => note.id));
      writeNotes(notes.map((note) => (ids.has(note.id) ? { ...note, read: true } : note)));
    }
    return pending;
  });
}

function sameWorkspace(a, b) {
  if (!a || !b) return false;
  const norm = (value) => path.resolve(String(value)).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** Inserciones del usuario en un workspace, las más nuevas al final. */
export function recentInsertions(workspace, sinceMs = 2 * 60 * 60 * 1000) {
  const cutoff = Date.now() - sinceMs;
  return readNotes().filter((note) => {
    if (note.kind !== 'insertion' || !note.workspace) return false;
    if (workspace && !sameWorkspace(note.workspace, workspace)) return false;
    const at = Date.parse(note.at);
    return Number.isFinite(at) && at >= cutoff;
  });
}

export function unreadSessionIds() {
  return new Set(readNotes().filter((note) => note.read === false && note.sessionId).map((note) => note.sessionId));
}
