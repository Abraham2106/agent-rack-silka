import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addMemory, confirmMemory, expireMemory, listMemory, memoryPrefix, readMemory, recordFailure,
  replaceMemory, seedMemory, selectMemory, MEMORY_BUDGET_BYTES,
} from '../src/silka/memory.mjs';
import { readDecisions } from '../src/silka/state.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'silka-mem-'));
}

function writeLegacyRows(ws, rows) {
  fs.mkdirSync(path.join(ws, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.silka', 'decisions.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

test('MEM-01 las decisiones viejas (sin tipo ni etiquetas) siguen leyéndose', () => {
  const ws = tempWorkspace();
  writeLegacyRows(ws, [{ at: '2026-01-01T00:00:00.000Z', author: 'tú', sessionId: '', text: 'usar SQLite' }]);
  const [entry] = readMemory(ws);
  assert.equal(entry.type, 'decisión');
  assert.equal(entry.status, 'vigente');
  assert.deepEqual(entry.tags, []);
  assert.equal(readDecisions(ws)[0].text, 'usar SQLite');
});

test('MEM-01 agregar un aprendizaje con etiqueta lo deja en la lista', () => {
  const ws = tempWorkspace();
  const row = addMemory(ws, { type: 'aprendizaje', text: 'soltar el junction antes de borrar', tags: ['src/silka/tasks/'], author: 'manager' });
  const listed = listMemory(ws);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, row.id);
  assert.equal(listed[0].type, 'aprendizaje');
  assert.deepEqual(listed[0].tags, ['src/silka/tasks/']);
  assert.equal(listed[0].author, 'manager');
  assert.throws(() => addMemory(ws, { type: 'otra', text: 'x' }), /Tipo de memoria/);
});

test('MEM-02 solo entran las etiquetas del alcance de la tarea', () => {
  const ws = tempWorkspace();
  addMemory(ws, { type: 'aprendizaje', text: 'UI: usar tokens de color', tags: ['src/silka/ui/'] });
  addMemory(ws, { type: 'aprendizaje', text: 'cola: un solo escritor', tags: ['src/silka/merge/'] });
  const prefix = memoryPrefix(ws, ['src/silka/ui/status.mjs']);
  assert.ok(prefix.includes('UI: usar tokens de color'));
  assert.ok(!prefix.includes('cola: un solo escritor'));
  assert.equal(memoryPrefix(ws, ['docs/']), '');
});

test('MEM-03 tope de 2 KB: lo que no cabe queda como referencia', () => {
  const ws = tempWorkspace();
  const long = 'x'.repeat(900);
  for (let i = 0; i < 4; i += 1) addMemory(ws, { type: 'aprendizaje', text: `${i} ${long}`, tags: ['src/a/'] });
  const sel = selectMemory(ws, ['src/a/b.mjs']);
  assert.equal(sel.picked.length + sel.rest.length, 4);
  assert.ok(sel.rest.length >= 1, 'al menos una entrada no cabe');
  const prefix = memoryPrefix(ws, ['src/a/b.mjs']);
  assert.ok(Buffer.byteLength(prefix, 'utf8') < MEMORY_BUDGET_BYTES + 400);
  assert.match(prefix, /Otras \d+ entradas no caben/);
});

test('MEM-04 una propuesta de fallo queda pendiente y no se inyecta hasta confirmarla', () => {
  const ws = tempWorkspace();
  const reason = 'setup falló: npm ci en C:\\Users\\x\\wt\\abc1234 (código 1)';
  assert.equal(recordFailure(ws, { taskId: 'tk-1', scope: ['src/x/'], reason }), null);
  const proposal = recordFailure(ws, { taskId: 'tk-2', scope: ['src/x/'], reason: 'setup falló: npm ci en C:\\Users\\y\\wt\\def5678 (código 1)' });
  assert.ok(proposal, 'la segunda causa repetida propone un aprendizaje');
  assert.equal(proposal.status, 'pendiente');
  assert.equal(memoryPrefix(ws, ['src/x/y.mjs']), '');
  const confirmed = confirmMemory(ws, proposal.id, { by: 'manager' });
  assert.equal(confirmed.status, 'vigente');
  assert.ok(memoryPrefix(ws, ['src/x/y.mjs']).includes('Fallo repetido'));
  assert.throws(() => confirmMemory(ws, proposal.id), /no está pendiente/);
});

test('MEM-05 vencidas y reemplazadas se marcan, no se borran, y no se inyectan', () => {
  const ws = tempWorkspace();
  const old = addMemory(ws, { type: 'preferencia', text: 'respuestas cortas', tags: ['*'] });
  const next = replaceMemory(ws, old.id, 'respuestas en español, con detalle', { by: 'tú' });
  const obsolete = addMemory(ws, { type: 'decisión', text: 'usar la API vieja', tags: ['src/api/'] });
  expireMemory(ws, obsolete.id);
  const all = listMemory(ws, { all: true });
  assert.equal(all.length, 3);
  assert.equal(all.find((e) => e.id === old.id).status, 'reemplazada');
  assert.equal(all.find((e) => e.id === obsolete.id).status, 'vencida');
  const prefix = memoryPrefix(ws, ['src/api/x.mjs']);
  assert.ok(!prefix.includes('usar la API vieja'));
  assert.ok(prefix.includes(next.text), 'la global vigente sí entra');
  const global = memoryPrefix(ws, ['src/cualquiera.mjs']);
  assert.ok(global.includes(next.text));
  assert.ok(!global.includes('respuestas cortas'));
});

test('3.3 aprendizajes conocidos se cargan una vez y llegan a una tarea de worktrees', () => {
  const ws = tempWorkspace();
  const first = seedMemory(ws);
  assert.ok(first.length >= 1);
  assert.equal(seedMemory(ws).length, 0, 'segunda carga no duplica');
  const prefix = memoryPrefix(ws, ['src/silka/tasks/worktree.mjs']);
  assert.ok(prefix.includes('rmdir node_modules'));
});

test('2.2 el encargo enviado al agente contiene las entradas del alcance', async () => {
  const repo = tempWorkspace();
  gitRun(repo, ['init', '-b', 'main']);
  gitRun(repo, ['config', 'user.email', 't@example.com']);
  gitRun(repo, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  gitRun(repo, ['add', 'README.md']);
  gitRun(repo, ['commit', '-m', 'base']);
  addMemory(repo, { type: 'aprendizaje', text: 'MEMORIA-PRUEBA-HUB', tags: ['src/hub/'] });
  const prompts = [];
  const client = {
    async createSession(agent, prompt, workspace) {
      prompts.push(prompt);
      fs.mkdirSync(path.join(workspace, 'src', 'hub'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'src', 'hub', 'out.txt'), 'ok');
      return { sessionId: 'sess-mem', status: 'running', agentId: agent };
    },
    async listSessions() { return []; },
    async getSessionStatus() { return { status: 'running' }; },
    async close() {},
  };
  const mgr = createTaskManager(repo, { preferManual: false });
  await mgr.launch([{
    id: 'tk-mem', title: 'hub', scope: 'src/hub/', deliver: 'cambio', verify: 'node -e "process.exit(0)"',
  }], { callHub: createHubCallAdapter(client), manual: false });
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].startsWith('Memoria del proyecto'));
  assert.ok(prompts[0].includes('MEMORIA-PRUEBA-HUB'));
  assert.ok(prompts[0].indexOf('MEMORIA-PRUEBA-HUB') < prompts[0].indexOf('hub\n'));
});

test('1.2 silka.memory.* en Code Mode: add, list y expire', async () => {
  const { createApiDispatcher } = await import('../src/silka/codemode/api-dispatch.mjs');
  const ws = tempWorkspace();
  const dispatch = createApiDispatcher({
    workspace: ws,
    callHub: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const row = await dispatch(['memory', 'add'], [{ type: 'preferencia', text: 'tablas cortas', tags: ['*'] }]);
  assert.equal(row.type, 'preferencia');
  assert.equal(row.author, 'manager');
  assert.equal((await dispatch(['memory', 'list'], [{ all: false }])).length, 1);
  await dispatch(['memory', 'expire'], [row.id]);
  assert.equal((await dispatch(['memory', 'list'], [{}])).length, 0);
  await assert.rejects(() => dispatch(['memory', 'add'], [{ type: 'decisión' }]));
});
