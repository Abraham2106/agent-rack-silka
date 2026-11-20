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

export function appendNote({ sessionId, text }) {
  const note = {
    id: crypto.randomUUID(),
    sessionId: String(sessionId),
    text: String(text),
    at: new Date().toISOString(),
    read: false,
  };
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

export function unreadSessionIds() {
  return new Set(readNotes().filter((note) => note.read === false && note.sessionId).map((note) => note.sessionId));
}
