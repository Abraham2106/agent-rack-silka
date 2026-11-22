import fs from 'node:fs';
import path from 'node:path';
import { mergeJournalPath } from './paths.mjs';

export function appendJournal(repoRoot, row) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`;
  const file = mergeJournalPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
  return row;
}

export function readJournal(repoRoot) {
  const file = mergeJournalPath(repoRoot);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Último paso abierto (before sin after) por tarea. */
export function openJournalSteps(repoRoot) {
  const entries = readJournal(repoRoot);
  const open = new Map();
  for (const row of entries) {
    const key = `${row.taskId}:${row.step}`;
    if (row.phase === 'before') open.set(key, row);
    if (row.phase === 'after') open.delete(key);
  }
  return [...open.values()];
}