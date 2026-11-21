// Escenarios de openspec/specs/isolated-tasks/spec.md sin cobertura en
// tasks.test.mjs ni worktree-guard.test.mjs: la mitad "dependencia descartada" de
// FR-TK-03, NFR-DISK-01 (T-TK-05), FR-TK-08/09 (T-CC-09) y SEC-06 (T-TK-04)
// sobre las operaciones git del gestor, no solo sobre gitRun.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { warnLiveWorktreeBudget } from '../src/silka/tasks/disk.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { mutateTaskStore, readTaskStore } from '../src/silka/tasks/store.mjs';

const OK = 'node -e "process.exit(0)"';

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-spec-tk-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git('add', 'README.md');
  git('commit', '-m', 'base');
  return dir;
}

function baseTask(overrides = {}) {
  return { title: 't', scope: 'src/', deliver: 'x', verify: OK, ...overrides };
}

test('T-TK-02 (FR-TK-03): descartar la dependencia bloquea y avisa a la tarea dependiente', async () => {
  const repo = initRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([
    baseTask({ id: 'tk-base', title: 'base' }),
    baseTask({ id: 'tk-hijo', title: 'hijo', dependsOn: ['tk-base'] }),
  ]);
  assert.equal(mgr.list().find((t) => t.id === 'tk-hijo').state, STATES.ESPERANDO_DEPS);

  mgr.requestDiscard('tk-base');
  mgr.schedule({ manual: true });

  const hijo = mgr.list().find((t) => t.id === 'tk-hijo');
  assert.equal(hijo.state, STATES.BLOQUEADA);
  assert.match(hijo.blockedReason || '', /descartad/i, 'el motivo es visible en la tarea');
  assert.ok(hijo.transitions.some((tr) => tr.to === STATES.BLOQUEADA && tr.cause === 'dependencia_descartada'));
  assert.equal(hijo.worktreePath, null, 'no se crea worktree para la tarea bloqueada');
});

test('T-TK-05 (NFR-DISK-01): sesión viva conserva su worktree y el exceso avisa', async () => {
  const repo = initRepo();
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 1 });
  await mgr.launch([
    baseTask({ id: 'tk-viva', title: 'viva' }),
    baseTask({ id: 'tk-cola', title: 'cola' }),
  ]);
  assert.equal(mgr.list().find((t) => t.id === 'tk-cola').worktreePath, null, 'tope de simultaneidad');

  const wt = mgr.list().find((t) => t.id === 'tk-viva').worktreePath;
  mgr.setSessionAlive('tk-viva', true);
  mgr.cleanupTask('tk-viva');
  assert.ok(fs.existsSync(wt), 'no se elimina el worktree mientras la sesión sigue viva');

  const logs = [];
  assert.deepEqual(warnLiveWorktreeBudget(repo, { log: (m) => logs.push(m) }), { alive: 1, limit: 1 });
  assert.equal(logs.length, 0, 'dentro del tope no hay aviso');

  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-extra-wt-'));
  mutateTaskStore(repo, (store) => {
    store.tasks.find((t) => t.id === 'tk-cola').worktreePath = extra;
    return store;
  });
  assert.deepEqual(warnLiveWorktreeBudget(repo, { log: (m) => logs.push(m) }), { alive: 2, limit: 1 });
  assert.equal(logs.length, 1, 'por encima del tope suave avisa');
  assert.match(logs[0], /worktrees vivos \(2\).*tope suave \(1\)/);
  fs.rmSync(extra, { recursive: true, force: true });
});

test('T-CC-09 (FR-TK-08): el excedente de maxConcurrentTasks entra en cola y avanza al liberar cupo', async () => {
  const repo = initRepo();
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 2 });
  const ids = ['tk-1', 'tk-2', 'tk-3', 'tk-4'];
  await mgr.launch(ids.map((id) => baseTask({ id, title: id })));

  assert.equal(readTaskStore(repo).maxConcurrentTasks, 2);
  for (const id of ids.slice(0, 2)) {
    const row = mgr.list().find((t) => t.id === id);
    assert.equal(row.state, STATES.TRABAJANDO);
    assert.ok(row.worktreePath);
  }
  for (const id of ids.slice(2)) {
    const row = mgr.list().find((t) => t.id === id);
    assert.equal(row.state, STATES.PLANIFICADA);
    assert.equal(row.worktreePath, null, 'sin worktree hasta que haya cupo');
  }

  await mgr.runAgentTurn('tk-1', async () => {});
  assert.equal(mgr.list().find((t) => t.id === 'tk-1').state, STATES.LISTA);
  mgr.markMerged('tk-1');

  const rows = mgr.list();
  assert.ok(rows.find((t) => t.id === 'tk-3').worktreePath, 'la siguiente de la cola ocupa el cupo');
  assert.equal(rows.find((t) => t.id === 'tk-3').state, STATES.TRABAJANDO);
  assert.equal(rows.find((t) => t.id === 'tk-4').worktreePath, null, 'la cuarta sigue esperando');
});

test('T-CC-09 (FR-TK-09): dos tareas paralelas reciben SILKA_PORT_n distintos y libres', async () => {
  const repo = initRepo();
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 2 });
  const ids = ['tk-p1', 'tk-p2'];
  await mgr.launch(ids.map((id) => baseTask({ id, title: id, ports: 2 })));

  const rows = ids.map((id) => mgr.list().find((t) => t.id === id));
  for (const row of rows) assert.equal(row.allocatedPorts.length, 2);
  assert.ok(rows[0].allocatedPorts.every((p) => !rows[1].allocatedPorts.includes(p)), 'sin reutilizar puertos entre tareas vivas');
  assert.deepEqual(mgr.portsEnvFor('tk-p1'), {
    SILKA_PORT_1: String(rows[0].allocatedPorts[0]),
    SILKA_PORT_2: String(rows[0].allocatedPorts[1]),
  });
  assert.deepEqual(mgr.portsEnvFor('tk-p2'), {
    SILKA_PORT_1: String(rows[1].allocatedPorts[0]),
    SILKA_PORT_2: String(rows[1].allocatedPorts[1]),
  });

  const file = JSON.parse(fs.readFileSync(path.join(repo, '.silka', 'ports.json'), 'utf8'));
  for (const row of rows) assert.deepEqual(file.allocated[row.id], row.allocatedPorts);
});

test('T-TK-04 (SEC-06): el hub no corre hooks del agente al crear, verificar y mezclar', async () => {
  const repo = initRepo();
  const hooks = path.join(repo, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const hook = path.join(hooks, 'post-checkout');
  fs.writeFileSync(hook, '#!/bin/sh\necho hook > HOOK_EJECUTADO.txt\n');
  if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);

  // Control: con hooks habilitados el post-checkout sí dispara; así la prueba no es vacía.
  const controlWt = path.join(os.tmpdir(), `silka-control-hooks-${Date.now()}`);
  const control = spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '-b', 'control-hooks', controlWt, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  assert.equal(control.status, 0, control.stderr);
  assert.ok(fs.existsSync(path.join(controlWt, 'HOOK_EJECUTADO.txt')), 'el hook del agente sí se dispara con hooks habilitados');
  spawnSync('git', ['worktree', 'remove', '--force', controlWt], { cwd: repo, encoding: 'utf8' });
  spawnSync('git', ['branch', '-D', 'control-hooks'], { cwd: repo, encoding: 'utf8' });

  const mgr = createTaskManager(repo);
  await mgr.launch([baseTask({ id: 'tk-hooks' })]);
  const wt = mgr.list().find((t) => t.id === 'tk-hooks').worktreePath;
  await mgr.runAgentTurn('tk-hooks', async (cwd) => {
    fs.writeFileSync(path.join(cwd, 'cambio.txt'), 'x');
  });
  assert.equal(fs.existsSync(path.join(wt, 'HOOK_EJECUTADO.txt')), false, 'post-checkout no corrió al crear el worktree');
  assert.equal(fs.existsSync(path.join(repo, 'HOOK_EJECUTADO.txt')), false, 'nada se ejecutó en el repo principal');
  mgr.markMerged('tk-hooks');
  assert.equal(fs.existsSync(path.join(repo, 'HOOK_EJECUTADO.txt')), false);
});
