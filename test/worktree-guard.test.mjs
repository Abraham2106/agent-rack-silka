// BUG-06 y setup al crear el worktree (docs/bugs/2026-11-21-registro-y-supervisor.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { silkaDataDir, worktreesBase } from '../src/silka/paths.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { lockfileHash } from '../src/silka/tasks/setup.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { isValidWorktree, worktreePath } from '../src/silka/tasks/worktree.mjs';

const OK = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';
const norm = (p) => path.resolve(p).replaceAll('\\', '/').toLowerCase();

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-wg-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

/** Hub falso: registra las llamadas; `onCreate` permite simular carreras. */
function fakeHub({ onCreate } = {}) {
  const calls = [];
  let n = 0;
  const callHub = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'agent_session_create') {
      n += 1;
      await onCreate?.(payload);
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId: `s${n}`, status: 'running' }) }] };
    }
    return { content: [{ type: 'text', text: '{}' }] };
  };
  return { calls, callHub };
}

async function launchOne(repo, task, hub) {
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([{ title: 't', scope: 'src/', deliver: 'x', verify: OK, ...task }], { callHub: hub.callHub, manual: false });
  return mgr;
}

test('WG-01 el worktree de una tarea vive fuera del repo, en la carpeta de datos de Silka', () => {
  const repo = initRepo();
  const wt = worktreePath(repo, 'tk-x');
  assert.ok(!norm(wt).startsWith(`${norm(repo)}/`), 'no cuelga del repo');
  assert.ok(norm(wt).startsWith(`${norm(silkaDataDir())}/`), 'cuelga de la carpeta de datos');
  assert.notEqual(worktreesBase(repo), worktreesBase(initRepo()), 'cada repo tiene su carpeta');
});

test('WG-02 isValidWorktree distingue un worktree real de uno perdido', async () => {
  const repo = initRepo();
  const hub = fakeHub();
  const mgr = await launchOne(repo, { id: 'tk-v' }, hub);
  const wt = mgr.list().find((t) => t.id === 'tk-v').worktreePath;
  assert.equal(isValidWorktree(wt), true);
  fs.rmSync(path.join(wt, '.git'));
  assert.equal(isValidWorktree(wt), false, 'sin .git');
  assert.equal(isValidWorktree(path.join(os.tmpdir(), 'no-existe-silka')), false);
});

test('WG-03 worktree perdido: no se verifica, no se toca el repo principal y no se reanuda al agente', async () => {
  const repo = initRepo();
  const hub = fakeHub();
  const mgr = await launchOne(repo, { id: 'tk-lost', verify: 'node -e "require(\'fs\').writeFileSync(\'ESCAPE.txt\',\'x\')"', maxRepairs: 1 }, hub);
  const task = mgr.list().find((t) => t.id === 'tk-lost');
  assert.equal(task.state, STATES.TRABAJANDO);
  fs.rmSync(path.join(task.worktreePath, '.git'));
  mgr.setSessionAlive('tk-lost', false);
  const card = mgr.verifyTask('tk-lost');
  assert.equal(card.gates, 'fail');
  assert.ok(card.evidence.some((e) => e.kind === 'setup' && !e.ok && /worktree ausente/.test(e.detail)));
  assert.ok(!card.evidence.some((e) => e.kind === 'verify'), 'el verify no corrió');
  assert.equal(fs.existsSync(path.join(repo, 'ESCAPE.txt')), false, 'nada escrito en el repo principal');
  const sendsBefore = hub.calls.filter((c) => c.name === 'agent_session_send').length;
  await mgr.dispatchPendingRepairs({ callHub: hub.callHub });
  assert.equal(hub.calls.filter((c) => c.name === 'agent_session_send').length, sendsBefore, 'no se reanuda al agente');
  assert.equal(mgr.list().find((t) => t.id === 'tk-lost').state, STATES.BLOQUEADA);
});

test('WG-04 si la tarea se descarta mientras se crea su sesión, esa sesión se cancela', async () => {
  const repo = initRepo();
  let mgr;
  const hub = fakeHub({
    onCreate: async () => { mgr.transition('tk-race', STATES.DESCARTADA, 'descartada_en_carrera'); },
  });
  mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([{ id: 'tk-race', title: 't', scope: 'src/', deliver: 'x', verify: OK }], { callHub: hub.callHub, manual: false });
  const cancels = hub.calls.filter((c) => c.name === 'agent_session_cancel');
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].payload.sessionId, 's1');
  const row = mgr.list().find((t) => t.id === 'tk-race');
  assert.equal(row.state, STATES.DESCARTADA);
  assert.ok(!row.sessionId, 'la tarea descartada no queda con sesión');
});

test('WG-05 el setup corre al crear el worktree, antes del agente, y queda en la evidencia', async () => {
  const repo = initRepo();
  const order = [];
  const hub = fakeHub({ onCreate: async (p) => { order.push(fs.existsSync(path.join(p.workspace, 'SETUP_HECHO')) ? 'agente-con-setup' : 'agente-sin-setup'); } });
  const mgr = await launchOne(repo, { id: 'tk-setup', setup: ['node -e "require(\'fs\').writeFileSync(\'SETUP_HECHO\',\'1\')"'] }, hub);
  assert.deepEqual(order, ['agente-con-setup']);
  const row = mgr.list().find((t) => t.id === 'tk-setup');
  assert.ok(row.setupDoneAt);
  assert.ok(row.setupEvidence.some((e) => e.kind === 'setup' && e.ok));
});

test('WG-06 si el setup falla al crear, el agente no arranca y la ficha trae el error', async () => {
  const repo = initRepo();
  const hub = fakeHub();
  const mgr = await launchOne(repo, { id: 'tk-setup-ko', setup: [FAIL] }, hub);
  assert.equal(hub.calls.filter((c) => c.name === 'agent_session_create').length, 0);
  const row = mgr.list().find((t) => t.id === 'tk-setup-ko');
  assert.equal(row.state, STATES.VERIFICACION_FALLIDA);
  assert.ok(row.card.evidence.some((e) => e.kind === 'setup' && !e.ok && e.cmd === FAIL));
});

test('WG-07 verify no repite el setup si el lockfile no cambió, y sí si cambió', async () => {
  const repo = initRepo();
  const counter = (wt) => Number(fs.existsSync(path.join(wt, 'n.txt')) ? fs.readFileSync(path.join(wt, 'n.txt'), 'utf8') : 0);
  const bump = 'node -e "const f=require(\'fs\');const n=f.existsSync(\'n.txt\')?+f.readFileSync(\'n.txt\',\'utf8\'):0;f.writeFileSync(\'n.txt\',String(n+1))"';
  const hub = fakeHub();
  const mgr = await launchOne(repo, { id: 'tk-lock', setup: [bump] }, hub);
  const wt = mgr.list().find((t) => t.id === 'tk-lock').worktreePath;
  assert.equal(counter(wt), 1, 'setup al crear');
  mgr.setSessionAlive('tk-lock', false);
  const card = mgr.verifyTask('tk-lock');
  assert.equal(counter(wt), 1, 'sin cambios en el lockfile no se repite');
  assert.ok(card.evidence.some((e) => e.kind === 'setup' && /lockfile sin cambios/.test(e.cmd)));
  assert.ok(card.evidence.some((e) => e.kind === 'verify'), 'la evidencia del verify se suma a la del setup');

  const before = lockfileHash(wt);
  fs.writeFileSync(path.join(wt, 'package-lock.json'), '{"lockfileVersion":3}');
  assert.notEqual(lockfileHash(wt), before);
  mgr.transition('tk-lock', STATES.RECHAZADA, 'prueba');
  mgr.transition('tk-lock', STATES.TRABAJANDO, 'prueba');
  mgr.setSessionAlive('tk-lock', false);
  mgr.verifyTask('tk-lock');
  assert.equal(counter(wt), 2, 'lockfile cambiado: se repite el setup');
});
