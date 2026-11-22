// BUG-05 (hallado al reproducirlo con agent-rack real): el launch del bridge y el supervisor del
// hub arrancaban la misma tarea a la vez y salían dos sesiones del agente. Con el reclamo de
// arranque, dos procesos que arrancan las mismas tareas a la vez crean una sola sesión por tarea.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-claim-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

const MANAGER_URL = new URL('../src/silka/tasks/manager.mjs', import.meta.url).href;

/** Código que arranca las tareas pendientes con un hub falso lento que anota cada sesión creada. */
const starter = (repo, logFile) => `
import fs from 'node:fs';
import path from 'node:path';
const { createTaskManager } = await import(${JSON.stringify(MANAGER_URL)});
let n = 0;
const callHub = async (name, args) => {
  if (name !== 'agent_session_create') return { content: [{ type: 'text', text: '{}' }] };
  await new Promise((r) => setTimeout(r, 150));
  fs.appendFileSync(${JSON.stringify(logFile)}, path.basename(args.workspace) + '\\n');
  n += 1;
  return { content: [{ type: 'text', text: JSON.stringify({ sessionId: process.pid + '-' + n }) }] };
};
await createTaskManager(${JSON.stringify(repo)}).startPendingSessions({ callHub });
`;

test('dos procesos arrancan las mismas tareas a la vez → una sola sesión por tarea', async () => {
  const repo = initTempRepo();
  const logFile = path.join(repo, '..', `${path.basename(repo)}-creadas.txt`);
  const mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 6 });
  const ids = ['tk-c1', 'tk-c2', 'tk-c3', 'tk-c4', 'tk-c5', 'tk-c6'];
  await mgr.launch(ids.map((id) => ({ id, title: id, scope: 'x', deliver: 'x', verify: 'node -e "0"', setup: 'node -e "0"' })), { manual: false });
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', starter(repo, logFile)], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, err }));
  });
  const results = await Promise.all([run(), run(), run()]);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const created = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const counts = Object.fromEntries(ids.map((id) => [id, created.filter((c) => c === id).length]));
  for (const id of ids) assert.equal(counts[id], 1, `sesiones de ${id}: ${JSON.stringify(counts)}`);
  for (const t of mgr.list()) {
    assert.equal(t.state, STATES.TRABAJANDO);
    assert.equal(t.startingBy, undefined, 'el reclamo se suelta al arrancar');
  }
});

test('un reclamo de un proceso muerto no bloquea el arranque', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([{ id: 'tk-dead', title: 't', scope: 'x', deliver: 'x', verify: 'node -e "0"' }], { manual: false });
  const { mutateTaskStore } = await import('../src/silka/tasks/store.mjs');
  mutateTaskStore(repo, (store) => { store.tasks[0].startingBy = { pid: 999999, at: Date.now() }; return store; });
  assert.equal(mgr.claimStart('tk-dead'), true);
});
