// BUG-11: setup y verify corren en un proceso aparte; el ciclo del supervisor no se congela.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createJobRunner } from '../src/silka/tasks/jobs.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { mutateTaskStore } from '../src/silka/tasks/store.mjs';
import { startTaskSupervisor, superviseTasksOnce } from '../src/silka/tasks/supervisor.mjs';

const SLOW_VERIFY = 'node -e "setTimeout(()=>process.exit(0),3000)"';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-jobs-'));
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
        const sessionId = `sess-job-${n}`;
        fs.writeFileSync(path.join(workspace, 'entrega.txt'), 'ok');
        sessions.set(sessionId, { sessionId, status: 'running', workspace });
        return { sessionId, status: 'running' };
      },
      async listSessions() { return [...sessions.values()]; },
      async getSessionStatus(id) { return sessions.get(id) || { sessionId: id, status: 'completed' }; },
      async sendInput() { return {}; },
      async close() {},
    },
  };
}

const spec = (over = {}) => ({ title: 't', scope: 'entrega.txt', deliver: 'archivo', verify: SLOW_VERIFY, maxRepairs: 0, ...over });
const row = (mgr, id) => mgr.list().find((t) => t.id === id);

test('BUG-11: con jobs, el verify corre aparte y el ciclo del supervisor no espera', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([spec({ id: 'tk-job-v' })], { callHub: createHubCallAdapter(hub.client), manual: false });
  for (const s of hub.sessions.values()) s.status = 'completed';
  const jobs = createJobRunner();
  const t0 = Date.now();
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  const tickMs = Date.now() - t0;
  assert.ok(tickMs < 2500, `el ciclo no espera al verify de 3 s (tardó ${tickMs} ms)`);
  assert.equal(jobs.size, 1);
  assert.equal(row(mgr, 'tk-job-v').card, null, 'la ficha aún no está');
  // Mientras corre, otro ciclo no lanza un segundo verify.
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  assert.equal(jobs.size, 1);
  await jobs.idle();
  const done = row(mgr, 'tk-job-v');
  assert.equal(done.state, STATES.LISTA);
  assert.equal(done.card.gates, 'pass');
  assert.ok(done.card.evidence.some((e) => e.kind === 'verify' && e.ok && e.durationMs >= 2500));
  assert.equal(done.job, undefined, 'el proceso borra su marca al terminar');
});

test('BUG-11: con jobs, el setup corre aparte y la sesión se crea en un ciclo posterior', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false });
  // Sin callHub en launch: es el hub (supervisor) quien prepara y arranca.
  await mgr.launch([spec({ id: 'tk-job-s', verify: 'node -e "process.exit(0)"', setup: 'node -e "setTimeout(()=>{},1500)"' })], { manual: false });
  const jobs = createJobRunner();
  const t0 = Date.now();
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  assert.ok(Date.now() - t0 < 1400, 'el ciclo no espera al setup');
  assert.equal(hub.sessions.size, 0, 'sin setup terminado no se arranca al agente');
  await jobs.idle();
  assert.ok(row(mgr, 'tk-job-s').setupDoneAt);
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  assert.equal(hub.sessions.size, 1);
  assert.equal(row(mgr, 'tk-job-s').state, STATES.TRABAJANDO);
});

test('BUG-11: setup fallido en proceso aparte → verificacion_fallida sin arrancar al agente', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([spec({ id: 'tk-job-sf', setup: 'node -e "process.exit(3)"' })], { manual: false });
  const jobs = createJobRunner();
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  await jobs.idle();
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  const t = row(mgr, 'tk-job-sf');
  assert.equal(t.state, STATES.VERIFICACION_FALLIDA);
  assert.equal(hub.sessions.size, 0);
  assert.equal(t.card.evidence.find((e) => e.kind === 'setup').exitCode, 3);
});

test('BUG-11: un verify interrumpido (verificando sin ficha ni proceso vivo) se relanza', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([spec({ id: 'tk-job-r', verify: 'node -e "process.exit(0)"' })], { callHub: createHubCallAdapter(hub.client), manual: false });
  for (const s of hub.sessions.values()) s.status = 'completed';
  // Simula un hub que se cayó a mitad del verify: estado verificando, sin ficha, proceso muerto.
  mgr.recordSessionOutcome('tk-job-r', 'completed');
  mgrTransition(repo, 'tk-job-r', STATES.VERIFICANDO, { job: { kind: 'verify', pid: 999999, startedAt: 1 } });
  const jobs = createJobRunner();
  await superviseTasksOnce(hub.client, { repoRoots: [repo], jobs });
  assert.equal(jobs.size, 1, 'se relanzó');
  await jobs.idle();
  assert.equal(row(mgr, 'tk-job-r').state, STATES.LISTA);
});

test('readProcessStartMs da la hora de inicio real (antes salía corrida por el huso horario en Windows)', async () => {
  const { readProcessStartMs } = await import('../src/silka/lock.mjs');
  const ownStart = Math.round(Date.now() - process.uptime() * 1000);
  const live = readProcessStartMs(process.pid);
  assert.ok(Number.isFinite(live));
  assert.ok(Math.abs(live - ownStart) < 1500, `diferencia ${live - ownStart} ms`);
});

test('BUG-11: un proceso vivo con la marca en el store cuenta como ocupado; un pid reusado no', () => {
  const jobs = createJobRunner();
  const ownStart = Math.round(Date.now() - process.uptime() * 1000);
  assert.equal(jobs.busy('/x', { id: 'a', job: { pid: process.pid, startedAt: ownStart } }), true);
  assert.equal(jobs.busy('/x', { id: 'b', job: { pid: process.pid, startedAt: ownStart - 3_600_000 } }), false);
  assert.equal(jobs.busy('/x', { id: 'c', job: { pid: 999999, startedAt: ownStart } }), false);
  assert.equal(jobs.busy('/x', { id: 'd' }), false);
});

test('BUG-11: startTaskSupervisor no congela el proceso durante un verify largo', async () => {
  const repo = initTempRepo();
  const hub = fakeHub();
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([spec({ id: 'tk-job-loop', verify: 'node -e "setTimeout(()=>process.exit(0),4000)"' })], { callHub: createHubCallAdapter(hub.client), manual: false });
  for (const s of hub.sessions.values()) s.status = 'completed';
  let maxLag = 0;
  let last = Date.now();
  const lag = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 100); last = now; }, 100);
  const logs = [];
  const stop = startTaskSupervisor({
    readRuntime: () => ({ token: 't' }),
    connect: async () => hub.client,
    repoRoots: [repo],
    intervalMs: 100,
    log: (m) => logs.push(m),
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && row(mgr, 'tk-job-loop').state !== STATES.LISTA) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }
  clearInterval(lag);
  await stop();
  await stop.jobs.idle();
  assert.equal(row(mgr, 'tk-job-loop').state, STATES.LISTA);
  assert.ok(maxLag < 1500, `pausa máxima del proceso ${maxLag} ms (con spawnSync era de ~4000)`);
  assert.ok(logs.some((m) => /verify de tk-job-loop en proceso aparte/.test(m)));
});

function mgrTransition(repo, id, state, extra) {
  mutateTaskStore(repo, (store) => {
    const t = store.tasks.find((x) => x.id === id);
    t.state = state;
    Object.assign(t, extra);
    return store;
  });
}
