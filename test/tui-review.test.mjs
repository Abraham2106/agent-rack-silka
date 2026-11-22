import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formatInboxRow,
  inboxListLines,
  inboxWindow,
  loadReviewInbox,
  reviewBannerFromError,
  reviewDetailLines,
  reviewFooterKeys,
} from '../src/silka/ui/review.mjs';
import { silkaError } from '../src/silka/codemode/errors.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { readTaskLogRef } from '../src/silka/tasks/log-store.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

const VERIFY_OK = 'node -e "process.exit(0)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-tui-rv-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

async function listaTask(repoRoot, id = 'tk-tui') {
  const mgr = createTaskManager(repoRoot);
  await mgr.launch([{
    id,
    title: 'tarea tui',
    scope: 'src/',
    deliver: 'cambio',
    verify: VERIFY_OK,
  }]);
  await mgr.runAgentTurn(id, async (cwd) => {
    const file = path.join(cwd, 'src', 'f.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'ok');
  });
  const task = mgr.list().find((t) => t.id === id);
  assert.equal(task.state, STATES.LISTA);
  return task;
}

test('FR-RV-07 ventana de bandeja y fila sin diff embebido', () => {
  const items = [
    { id: 'a', title: 'uno', risk: 'alto', gates: 'pass', version: 2, diffStats: { added: 3, removed: 1 } },
    { id: 'b', title: 'dos', risk: 'bajo', gates: 'fail', version: 1, diffStats: { added: 0, removed: 0 } },
  ];
  const win = inboxWindow(items, 1, 1);
  assert.equal(win.at, 1);
  assert.equal(win.rows.length, 1);
  assert.equal(win.rows[0].id, 'b');
  const row = formatInboxRow(items[0], { selected: true });
  assert.match(row, /▸/);
  assert.match(row, /v2/);
  assert.ok(!row.includes('@@'));
  const { lines } = inboxListLines(items, 0, 6);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /▸/);
});

test('FR-RV-07 detalle carga log por referencia', async () => {
  const repoRoot = initTempRepo();
  const task = await listaTask(repoRoot);
  const { items } = loadReviewInbox(repoRoot);
  const item = items.find((i) => i.id === task.id);
  assert.ok(item);
  assert.ok(item.verifyRef, 'verifyRef en la ficha de bandeja');
  readTaskLogRef(item.verifyRef, repoRoot);
  const lines = reviewDetailLines(repoRoot, item);
  assert.ok(lines.some((l) => l.includes(item.verifyRef)));
  assert.ok(!lines.some((l) => l.includes('@@')));
  assert.ok(!Object.prototype.hasOwnProperty.call(item, 'diff'));
});

test('FR-RV-07 aprobar desde servicio refresca bandeja', async () => {
  const repoRoot = initTempRepo();
  const task = await listaTask(repoRoot, 'tk-ap');
  const { items: before } = loadReviewInbox(repoRoot);
  assert.equal(before.length, 1);
  const svc = createReviewService(repoRoot, { actor: 'human' });
  svc.approve(task.id, { version: task.version });
  const { items: after } = loadReviewInbox(repoRoot);
  assert.equal(after.length, 0);
});

test('FR-RV-07 pie de bandeja y E_STALE', () => {
  const keys = reviewFooterKeys(120);
  const text = keys.map((s) => s.text).join('');
  assert.match(text, /a/);
  assert.match(text, /x/);
  assert.match(text, /d/);
  const banner = reviewBannerFromError(silkaError('E_STALE', 'viejo', { card: { id: 'x' } }));
  assert.equal(banner.refresh, true);
  assert.match(banner.text, /cambió/);
});