// Punto 6 del plan: reusar el id de una tarea descartada daba un E_CONFLICT críptico.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isSilkaError } from '../src/silka/codemode/errors.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-ids-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

const spec = (id) => ({ id, title: id, scope: 'x', deliver: 'x', verify: 'node -e "0"' });

test('id de una tarea descartada: mensaje claro con la salida', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([spec('tk-dup')]);
  mgr.requestDiscard('tk-dup');
  await assert.rejects(mgr.launch([spec('tk-dup')]), (err) => {
    assert.ok(isSilkaError(err));
    assert.equal(err.code, 'E_CONFLICT');
    assert.match(err.message, /descartada/);
    assert.match(err.message, /tk-dup-2/);
    assert.match(err.message, /--reemplazar/);
    return true;
  });
});

test('id de una tarea viva: dice su estado y que no se puede reemplazar', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([spec('tk-viva')]);
  await assert.rejects(mgr.launch([spec('tk-viva')], { replaceDiscarded: true }), (err) => /Ya hay una tarea tk-viva \(estado: trabajando\)/.test(err.message));
});

test('el mismo id dos veces en un plan se rechaza con motivo', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await assert.rejects(mgr.launch([spec('tk-r'), spec('tk-r')]), (err) => /repite el id tk-r/.test(err.message));
});

test('replaceDiscarded: relanza con el mismo id y conserva la vieja renombrada', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([spec('tk-re')]);
  mgr.requestDiscard('tk-re');
  const [launched] = await mgr.launch([spec('tk-re')], { replaceDiscarded: true });
  assert.equal(launched.id, 'tk-re');
  assert.equal(launched.state, STATES.TRABAJANDO);
  assert.ok(fs.existsSync(launched.worktreePath));
  const old = mgr.list().find((t) => t.id === 'tk-re~reemplazada-1');
  assert.equal(old.state, STATES.DESCARTADA);
  assert.equal(old.replacedBy, 'tk-re');
  // Una segunda vez: la anterior queda como -2.
  mgr.requestDiscard('tk-re');
  await mgr.launch([spec('tk-re')], { replaceDiscarded: true });
  assert.ok(mgr.list().some((t) => t.id === 'tk-re~reemplazada-2'));
});
