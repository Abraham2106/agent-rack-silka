import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendNote, deleteSessionNotes, managerNotes, migrateLegacyNotes, notesSummary, pruneNotes } from '../src/silka/notes.mjs';
import { readStore, refreshConflicts } from '../src/silka/state.mjs';
import { scanWorkspaces } from '../src/silka/ui/workspace-worker.mjs';

function configDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-sn-cfg-'));
  process.env.SILKA_CONFIG_DIR = dir;
  return dir;
}

function writeLegacy(dir, notes) {
  fs.writeFileSync(path.join(dir, 'notes.jsonl'), notes.map((n) => JSON.stringify(n)).join('\n') + '\n');
}

function note(sessionId, text, extra = {}) {
  return { id: `${sessionId}-${text}-${Math.random()}`, sessionId, text, at: new Date().toISOString(), read: false, ...extra };
}

test('SN-02 y SN-03: sin sesión solo conteos; con sesión, 20 más recientes y el resto contado', () => {
  configDir();
  for (let i = 0; i < 100; i++) appendNote({ sessionId: 'sesion-x', text: `texto secreto ${i}` });
  appendNote({ sessionId: 'sesion-y', text: 'otra' });

  const summary = notesSummary();
  const raw = JSON.stringify(summary);
  assert.equal(raw.includes('texto secreto'), false, 'el resumen no trae textos');
  const x = summary.sessions.find((s) => s.sessionId === 'sesion-x');
  assert.deepEqual([x.total, x.unread], [100, 100]);

  const page = managerNotes({ sessionId: 'sesion-x' });
  assert.equal(page.notes.length, 20);
  assert.equal(page.omitted, 80);
  assert.match(page.hint, /80/);
  assert.equal(page.notes.at(-1).text, 'texto secreto 99', 'son las más recientes');

  const next = managerNotes({ sessionId: 'sesion-x' });
  assert.equal(next.notes.length, 20, 'las marcadas como leídas no vuelven; quedan 80 sin leer');
  assert.equal(next.omitted, 60);
});

test('SN-04: sesión cancelada y leída se borra; con notas sin leer se conserva', () => {
  configDir();
  appendNote({ sessionId: 'cerrada', text: 'a' });
  appendNote({ sessionId: 'cancelada-sin-leer', text: 'b' });
  appendNote({ sessionId: 'completa', text: 'c' });
  managerNotes({ sessionId: 'cerrada' });
  managerNotes({ sessionId: 'completa' });
  const sessions = [
    { sessionId: 'cerrada', status: 'cancelled' },
    { sessionId: 'cancelada-sin-leer', status: 'cancelled' },
    { sessionId: 'completa', status: 'completed' },
  ];
  const removed = pruneNotes({ sessions }).removed;
  assert.equal(removed, 1);
  const left = notesSummary().sessions.map((s) => s.sessionId).sort();
  assert.deepEqual(left, ['cancelada-sin-leer', 'completa'], 'una sesión completada sigue viva y conserva sus notas');
});

test('SN-05: sesión desaparecida conserva sus notas hasta 24 h aunque no estén leídas', () => {
  const dir = configDir();
  appendNote({ sessionId: 'reciente', text: 'a' });
  appendNote({ sessionId: 'vieja', text: 'b' });
  const viejaFile = path.join(dir, 'notes', 'vieja.jsonl');
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(viejaFile, old, old);
  pruneNotes({ sessions: [] });
  const left = notesSummary().sessions.map((s) => s.sessionId);
  assert.deepEqual(left, ['reciente'], 'la de 25 h se borra y la reciente sigue');
});

test('tarea mezclada o descartada: deleteSessionNotes borra el archivo de la sesión', () => {
  const dir = configDir();
  appendNote({ sessionId: 'tarea-1', text: 'x' });
  deleteSessionNotes('tarea-1');
  assert.equal(fs.existsSync(path.join(dir, 'notes', 'tarea-1.jsonl')), false);
});

test('1.2 migración: reparte por sesión, descarta conflictos, manager y sesiones inexistentes', () => {
  const dir = configDir();
  writeLegacy(dir, [
    note('sA', 'uno'),
    note('sA', 'Conflicto: codex 1234 y opencode 5678 tocan a.txt a la vez.'),
    note('sA', 'Conflicto: codex 1234 y opencode 5678 tocan a.txt a la vez.'),
    note('manager', 'Conflicto: x'),
    note('sA', 'dos'),
    note('gone', 'fantasma'),
  ]);
  const result = migrateLegacyNotes({ liveSessionIds: ['sA'] });
  assert.deepEqual(result, { migrated: 2, discarded: 4 });
  const kept = fs.readFileSync(path.join(dir, 'notes', 'sA.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).text);
  assert.deepEqual(kept, ['uno', 'dos']);
  assert.equal(fs.existsSync(path.join(dir, 'notes.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'notes.jsonl.migrado')), true);
  assert.deepEqual(migrateLegacyNotes({ liveSessionIds: ['sA'] }), { migrated: 0, discarded: 0 }, 'es idempotente');
});

test('4.1 conflicto como estado: diez ciclos dan una sola fila y ninguna nota', () => {
  const dir = configDir();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-sn-ws-'));
  spawnSync('git', ['init'], { cwd: ws, encoding: 'utf8' });
  const now = new Date().toISOString();
  fs.mkdirSync(path.join(ws, '.silka'), { recursive: true });
  const tasks = [
    { id: 't1', agent: 'codex', status: 'done', startedAt: now, finishedAt: now, files: [], ambiguous: ['a.txt'], summary: '' },
    { id: 't2', agent: 'opencode', status: 'running', startedAt: now, files: [], ambiguous: [] },
  ];
  fs.writeFileSync(path.join(ws, '.silka', 'tasks.json'), JSON.stringify({ tasks, conflicts: [] }));
  for (let i = 0; i < 10; i++) refreshConflicts(ws);
  const store = readStore(ws);
  assert.equal(store.conflicts.length, 1);
  assert.equal(store.conflicts[0].resolved, false);
  assert.equal(fs.existsSync(path.join(dir, 'notes')), false, 'ninguna nota escrita');

  const t2 = JSON.parse(fs.readFileSync(path.join(ws, '.silka', 'tasks.json'), 'utf8')).tasks[1];
  t2.status = 'done';
  fs.writeFileSync(path.join(ws, '.silka', 'tasks.json'), JSON.stringify({ tasks: [tasks[0], t2], conflicts: store.conflicts }));
  refreshConflicts(ws);
  assert.equal(readStore(ws).conflicts[0].resolved, true, 'marcado resuelto cuando deja de darse');
});

test('4.2 el TUI marca ⚠ desde el estado del conflicto, no desde notas', () => {
  configDir();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-sn-tui-'));
  spawnSync('git', ['init'], { cwd: ws, encoding: 'utf8' });
  const now = new Date().toISOString();
  fs.mkdirSync(path.join(ws, '.silka'), { recursive: true });
  const tasks = [
    { id: 't1', agent: 'codex', status: 'done', startedAt: now, finishedAt: now, files: [], ambiguous: ['a.txt'], summary: '' },
    { id: 't2', agent: 'opencode', status: 'running', startedAt: now, files: [], ambiguous: [] },
  ];
  fs.writeFileSync(path.join(ws, '.silka', 'tasks.json'), JSON.stringify({ tasks, conflicts: [] }));
  const sessions = [
    { sessionId: 's-t1', agentId: 'codex', workspace: ws, createdAt: now, status: 'completed' },
    { sessionId: 's-t2', agentId: 'opencode', workspace: ws, createdAt: now, status: 'running' },
  ];
  const result = scanWorkspaces({ dirs: [ws], sessions, selectedWorkspace: ws });
  assert.ok(result.hot.includes('s-t1') && result.hot.includes('s-t2'), 'las dos sesiones del conflicto llevan ⚠');
  assert.equal(fs.existsSync(path.join(process.env.SILKA_CONFIG_DIR, 'notes')), false, 'sin notas de conflicto');
});
