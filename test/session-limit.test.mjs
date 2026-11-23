// BUG-10: ante "Maximum concurrent sessions" de agent-rack, esperar 30 s y avisar una sola vez.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitRun } from '../src/silka/tasks/git.mjs';
import {
  createTaskManager,
  resetSessionLimitBackoff,
  SESSION_LIMIT_BACKOFF_MS,
  sessionLimit,
} from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';

const LIMIT = "Error executing tool 'agent_session_create': Maximum concurrent sessions limit (5) reached.";

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-limit-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

test('BUG-10: con el tope de agent-rack lleno se espera 30 s y se avisa una sola vez', async () => {
  resetSessionLimitBackoff();
  const repo = initTempRepo();
  let full = true;
  let creates = 0;
  const sessions = new Map();
  const client = {
    async createSession(agent, prompt, workspace) {
      creates += 1;
      if (full) throw new Error(LIMIT);
      const sessionId = `s-${creates}`;
      sessions.set(sessionId, { sessionId, status: 'running', workspace });
      return { sessionId, status: 'running' };
    },
    async listSessions() { return [...sessions.values()]; },
    async getSessionStatus(id) { return sessions.get(id); },
    async close() {},
  };
  const mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 4 });
  const ids = ['tk-l1', 'tk-l2', 'tk-l3'];
  await mgr.launch(ids.map((id) => ({ id, title: id, scope: 'x', deliver: 'x', verify: 'node -e "0"' })), { manual: false });
  const logs = [];
  // Cota sin depender de la carga: la espera se fija al rechazar (entre `before` y ahora), así que
  // el plazo restante cae en [30 s, 30 s + lo que tarden los ciclos]. Medir contra Date.now() al
  // final fallaba cuando 10 ciclos con git real tardaban más de 5 s bajo carga.
  const before = Date.now();
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await superviseTasksOnce(client, { repoRoots: [repo], log: (m) => logs.push(m) });
  }
  assert.equal(creates, 1, 'tras el primer rechazo nadie pide sesión durante la espera');
  const limitLines = logs.filter((m) => /Maximum concurrent sessions|no da más sesiones/.test(m));
  assert.equal(limitLines.length, 1, logs.join('\n'));
  assert.match(limitLines[0], /30 s/);
  assert.ok(sessionLimit.until >= before + SESSION_LIMIT_BACKOFF_MS, 'la espera dura al menos 30 s');
  assert.ok(sessionLimit.until <= Date.now() + SESSION_LIMIT_BACKOFF_MS, 'y no más de 30 s desde que se fijó');
  assert.ok(mgr.list().every((t) => t.state === STATES.PLANIFICADA));

  // Pasan los 30 s (se simula) y sigue lleno: se reintenta una vez y no se vuelve a avisar.
  sessionLimit.until = 0;
  await superviseTasksOnce(client, { repoRoots: [repo], log: (m) => logs.push(m) });
  assert.equal(creates, 2);
  assert.equal(logs.filter((m) => /no da más sesiones/.test(m)).length, 1);

  // Hay cupo: arrancan todas y se avisa que volvió.
  full = false;
  sessionLimit.until = 0;
  await superviseTasksOnce(client, { repoRoots: [repo], log: (m) => logs.push(m) });
  assert.ok(mgr.list().every((t) => t.state === STATES.TRABAJANDO));
  assert.equal(logs.filter((m) => /vuelve a tener cupo/.test(m)).length, 1);
  resetSessionLimitBackoff();
});

test('BUG-10: otro error de arranque se anota una vez por tarea, no en cada ciclo', async () => {
  resetSessionLimitBackoff();
  const repo = initTempRepo();
  const client = {
    async createSession() { throw new Error('agente no disponible'); },
    async listSessions() { return []; },
    async close() {},
  };
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([{ id: 'tk-e1', title: 't', scope: 'x', deliver: 'x', verify: 'node -e "0"' }], { manual: false });
  const logs = [];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await superviseTasksOnce(client, { repoRoots: [repo], log: (m) => logs.push(m) });
  }
  assert.equal(logs.filter((m) => /no arrancó tk-e1/.test(m)).length, 1);
  assert.match(mgr.list()[0].startError, /agente no disponible/);
});
