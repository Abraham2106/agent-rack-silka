import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function notesFile() {
  return path.join(os.homedir(), '.config', 'silka', 'notes.jsonl');
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
  const file = notesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = notes.map((note) => JSON.stringify(note)).join('\n');
  fs.writeFileSync(file, body ? `${body}\n` : '');
}

export function appendNote({ sessionId, text }) {
  const note = {
    id: crypto.randomUUID(),
    sessionId: String(sessionId),
    text: String(text),
    at: new Date().toISOString(),
    read: false,
  };
  const file = notesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(note)}\n`);
  return note;
}

function matchesSession(note, sessionId) {
  if (!sessionId) return true;
  const id = String(note.sessionId ?? '');
  return id === sessionId || id.startsWith(sessionId);
}

/** Notas con read:false. Con markRead las marca y las reescribe. */
export function unreadNotes({ sessionId, markRead = true } = {}) {
  const notes = readNotes();
  const pending = notes.filter((note) => note.read === false && matchesSession(note, sessionId));
  if (markRead && pending.length) {
    const ids = new Set(pending.map((note) => note.id));
    writeNotes(notes.map((note) => (ids.has(note.id) ? { ...note, read: true } : note)));
  }
  return pending;
}

export function unreadSessionIds() {
  return new Set(readNotes().filter((note) => note.read === false && note.sessionId).map((note) => note.sessionId));
}
