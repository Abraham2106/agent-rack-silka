// La mezcla corre en un proceso aparte (como el verify, BUG-11) y una mezcla fallida deja una
// reparación pendiente que el supervisor de tareas despacha al agente.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { superviseMergeOnce } from '../src/silka/merge/supervisor.mjs';
import { createReviewService } from '../src/silka/review/service.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createJobRunner } from '../src/silka/tasks/jobs.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { mutateTaskStore } from '../src/silka/tasks/store.mjs';

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-mj-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  gitRun(dir, ['add', 'README.md']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

async function deliverAndApprove(repo, id, file, content, { verify = 'node -e "0"', sessionId } = {}) {
  const mgr = createTaskManager(repo);
  await mgr.launch([{ id, title: id, scope: file, deliver: file, verify }]);
  await mgr.runAgentTurn(id, async (cwd) => { fs.writeFileSync(path.join(cwd, file), content); });
  if (sessionId) mutateTaskStore(repo, (store) => { store.tasks.find((t) => t.id === id).sessionId = sessionId; return store; });
  const t = mgr.list().find((x) => x.id === id);
  assert.equal(t.state, STATES.LISTA, `${id} lista`);
  createReviewService(repo, { actor: 'human' }).approve(id, { version: t.version });
  return mgr;
}

const fakeClient = { async listSessions() { return []; } };
const row = (repo, id) => createTaskManager(repo).list().find((t) => t.id === id);

test('con jobs, la mezcla corre aparte: el ciclo no espera al verify sobre main', async () => {
  const repo = initTempRepo();
  await deliverAndApprove(repo, 'mj-a', 'a.txt', 'a', { verify: 'node -e "setTimeout(()=>process.exit(0),3000)"' });
  assert.equal(row(repo, 'mj-a').state, STATES.COLA_MEZCLA);
  const jobs = createJobRunner();
  const t0 = Date.now();
  await superviseMergeOnce(fakeClient, { repoRoots: [repo], jobs });
  assert.ok(Date.now() - t0 < 2000, `el ciclo no espera (${Date.now() - t0} ms)`);
  assert.equal(jobs.size, 1);
  // Mientras corre, otro ciclo no lanza otra mezcla del mismo repo.
  await superviseMergeOnce(fakeClient, { repoRoots: [repo], jobs });
  assert.equal(jobs.size, 1);
  await jobs.idle();
  assert.equal(row(repo, 'mj-a').state, STATES.MEZCLADA);
  const files = gitRun(repo, ['ls-tree', '-r', '--name-only', 'main']).stdout;
  assert.match(files, /a\.txt/);
});

test('mezcla con choque: queda reparación pendiente y el supervisor de tareas se la manda al agente', async () => {
  const repo = initTempRepo();
  await deliverAndApprove(repo, 'mj-1', 'x.txt', 'uno\n');
  const mgr = await deliverAndApprove(repo, 'mj-2', 'x.txt', 'dos\n', { sessionId: 'sess-mj-2' });
  const jobs = createJobRunner();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await superviseMergeOnce(fakeClient, { repoRoots: [repo], jobs });
    // eslint-disable-next-line no-await-in-loop
    await jobs.idle();
  }
  const t = row(repo, 'mj-2');
  assert.equal(t.state, STATES.REPARANDO);
  assert.equal(t.mergeFailure.kind, 'conflict');
  assert.match(t.pendingRepair.message, /choca con lo que ya está en main/);
  assert.match(t.pendingRepair.message, /git rebase main/);
  const sent = [];
  await mgr.dispatchPendingRepairs({ callHub: async (name, args) => { sent.push([name, args]); return {}; } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].sessionId, 'sess-mj-2');
  const after = row(repo, 'mj-2');
  assert.equal(after.state, STATES.TRABAJANDO);
  assert.equal(after.repairCount, 1);
});

test('mezcla fallida sin sesión del agente: queda en reparando sin aviso (decide el humano)', async () => {
  const repo = initTempRepo();
  await deliverAndApprove(repo, 'mj-s1', 'y.txt', 'uno\n');
  await deliverAndApprove(repo, 'mj-s2', 'y.txt', 'dos\n');
  const jobs = createJobRunner();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await superviseMergeOnce(fakeClient, { repoRoots: [repo], jobs });
    // eslint-disable-next-line no-await-in-loop
    await jobs.idle();
  }
  const t = row(repo, 'mj-s2');
  assert.equal(t.state, STATES.REPARANDO);
  assert.equal(t.pendingRepair, undefined);
});
