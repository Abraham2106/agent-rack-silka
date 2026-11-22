// Hallado con agent-rack real (e2e:ciclo con 6 tareas y tope de 4): las tareas en espera de cupo
// no avanzaban cuando otra pasaba a revisión, y la mezcla (proceso aparte, preferManual) las habría
// pasado a trabajando sin sesión de agente.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-q-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

function fakeHub() {
  const sessions = new Map();
  let n = 0;
  return {
    sessions,
    client: {
      async createSession(agent, prompt, workspace) {
        n += 1;
        const sessionId = `sq-${n}`;
        fs.writeFileSync(path.join(workspace, 'f.txt'), String(n));
        sessions.set(sessionId, { sessionId, status: 'running', workspace });
        return { sessionId, status: 'running' };
      },
      async listSessions() { return [...sessions.values()]; },
      async close() {},
    },
  };
}

const spec = (id) => ({ id, title: id, scope: 'f.txt', deliver: 'f', verify: 'node -e "0"', maxRepairs: 0 });

test('una tarea que pasa a revisión libera cupo y la siguiente en espera arranca con su agente', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 1 });
  await mgr.launch([spec('q-1'), spec('q-2')], { callHub: createHubCallAdapter(hub.client), manual: false });
  const state = (id) => mgr.list().find((t) => t.id === id);
  assert.equal(state('q-1').state, STATES.TRABAJANDO);
  assert.equal(state('q-2').state, STATES.PLANIFICADA);
  assert.equal(state('q-2').worktreePath, null);
  for (const s of hub.sessions.values()) s.status = 'completed';
  await superviseTasksOnce(hub.client, { repoRoots: [repo] }); // q-1 → lista
  await superviseTasksOnce(hub.client, { repoRoots: [repo] }); // q-2 toma el cupo
  assert.equal(state('q-1').state, STATES.LISTA);
  assert.equal(state('q-2').state, STATES.TRABAJANDO);
  assert.ok(state('q-2').sessionId, 'arrancó con sesión del agente');
});

test('una tarea del hub nunca pasa a trabajando sin agente, la programe quien la programe', async () => {
  const repo = initTempRepo();
  const mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 1 });
  await mgr.launch([spec('q-a'), spec('q-b')], { manual: false });
  // Como la mezcla: un manager con preferManual programa la cola.
  const mergeMgr = createTaskManager(repo, { preferManual: true });
  mergeMgr.requestDiscard('q-a');
  mergeMgr.schedule({ manual: true });
  const b = mgr.list().find((t) => t.id === 'q-b');
  assert.ok(b.worktreePath);
  assert.equal(b.state, STATES.PLANIFICADA);
  assert.equal(b.awaitingHubSession, true, 'espera al supervisor del hub para crear la sesión');
});
