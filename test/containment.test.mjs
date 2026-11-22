import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { visibleToolNames } from '../src/silka/bridge.mjs';
import { auditBlocked, auditFile, taskIdFromWorktree, taskScopeViolation } from '../src/silka/containment.mjs';
import { DEFAULT_SECRET_DENYLIST, deniedFiles, isDeniedPath, secretDenylist } from '../src/silka/tasks/denylist.mjs';
import { assessRisk } from '../src/silka/tasks/risk.mjs';
import { createTaskWorktree, removeTaskWorktree, worktreePath } from '../src/silka/tasks/worktree.mjs';
import { silkaDataDir } from '../src/silka/paths.mjs';

// SEC-15..17 y FR-AC-01 (agent-containment). Las pruebas usan un repo git temporal real para el
// worktree; el ciclo completo con agente real está en `npm run e2e:worktree`.

test('AC-04/SEC-17: la lista por defecto cubre .env, llaves y ssh, y deja pasar .env.example', () => {
  for (const file of ['.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'deploy/id_rsa', 'a/b.key']) {
    assert.equal(isDeniedPath(file), true, file);
  }
  for (const file of ['.env.example', 'src/app.mjs', 'README.md']) {
    assert.equal(isDeniedPath(file), false, file);
  }
  assert.equal(isDeniedPath(path.join(os.homedir(), '.ssh', 'config')), true);
  assert.deepEqual(deniedFiles(['x/.env', 'y.md']), ['x/.env']);
});

test('SEC-17: la lista es configurable y sin configuración rige la de por defecto', () => {
  assert.deepEqual(secretDenylist(null), [...DEFAULT_SECRET_DENYLIST]);
  assert.deepEqual(secretDenylist({ secretDenylist: ['secrets/**'] }), ['secrets/**']);
  assert.equal(isDeniedPath('secrets/db.txt', ['secrets/**']), true);
  assert.equal(isDeniedPath('.env', ['secrets/**']), false);
});

test('AC-04: el worktree no recibe .env versionado y el diff no lo muestra como borrado', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-contain-repo-'));
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
  try {
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=prueba\n');
    fs.writeFileSync(path.join(repo, 'app.mjs'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    const taskId = `contain-${Date.now().toString(36)}`;
    const wt = createTaskWorktree(repo, taskId, base);
    assert.deepEqual(wt.hiddenSecrets, ['.env']);
    assert.equal(fs.existsSync(path.join(wt.worktreePath, '.env')), false);
    assert.equal(fs.existsSync(path.join(wt.worktreePath, 'app.mjs')), true);
    const status = execFileSync('git', ['-C', wt.worktreePath, 'status', '--porcelain'], { encoding: 'utf8' });
    assert.equal(status.trim(), '', 'el .env oculto no aparece como cambio');
    removeTaskWorktree(repo, taskId, wt.worktreePath);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC-05: un diff que toca un archivo denegado queda en riesgo alto y exige humano', () => {
  const risk = assessRisk({ verifyOk: true, files: ['src/app.mjs', '.env'], diffLines: 3 });
  assert.equal(risk.level, 'alto');
  assert.equal(risk.requiresHuman, true);
  assert.ok(risk.reasons.includes('archivos_denegados'));
  assert.deepEqual(risk.deniedFiles, ['.env']);
  const clean = assessRisk({ verifyOk: true, files: ['src/app.mjs'], diffLines: 3 });
  assert.equal(clean.level, 'bajo');
  assert.equal(clean.requiresHuman, false);
});

test('SEC-16: una tarea solo toca su propio id y no lee contextos ni logs ajenos', () => {
  assert.match(taskScopeViolation('card', ['otra'], 'mia') || '', /no puede usar card/);
  assert.equal(taskScopeViolation('card', ['mia'], 'mia'), null);
  assert.equal(taskScopeViolation('get', ['log:otra#verify'], 'mia') !== null, true);
  assert.equal(taskScopeViolation('get', ['log:mia#verify'], 'mia'), null);
  assert.equal(taskScopeViolation('get', ['ctx:abc123'], 'mia') !== null, true);
  // Sin tarea (manager, sesión sin id) no hay restricción.
  assert.equal(taskScopeViolation('card', ['otra'], ''), null);
});

test('SEC-16: el id de la tarea sale de la carpeta de su worktree', () => {
  const wt = worktreePath('C:/proyecto/repo', 'tarea-1');
  assert.equal(taskIdFromWorktree(wt), 'tarea-1');
  assert.equal(taskIdFromWorktree(path.join(os.tmpdir(), 'tarea-1')), '');
});

test('AC-01/AC-02: a profundidad máxima ningún agente ve las herramientas de delegar', () => {
  const names = ['agent_session_create', 'opencode_run', 'silka_state', 'silka_notes'];
  assert.deepEqual(visibleToolNames(names, { depth: 1, max: 1, manager: false }).sort(), ['silka_state']);
  // Profundidad 2 permitida: el de profundidad 1 aún puede delegar.
  assert.equal(visibleToolNames(names, { depth: 1, max: 2, manager: false }).includes('agent_session_create'), true);
  assert.equal(visibleToolNames(names, { depth: 2, max: 2, manager: false }).includes('agent_session_create'), false);
});

test('FR-AC-01: cada intento bloqueado queda auditado con sesión, tarea, acción y hora', () => {
  const row = auditBlocked({ taskId: 'mia', action: 'agent_session_create', rule: 'SEC-15', message: 'prueba' });
  assert.equal(row.taskId, 'mia');
  assert.equal(row.rule, 'SEC-15');
  const lines = fs.readFileSync(auditFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = lines.at(-1);
  assert.equal(last.action, 'agent_session_create');
  assert.ok(Date.parse(last.at) > 0);
  assert.ok(auditFile().startsWith(silkaDataDir()));
});

test('AC-03/SEC-16: code mode de una tarea que pide otra tarea recibe E_POLICY', async () => {
  const { createApiDispatcher } = await import('../src/silka/codemode/api-dispatch.mjs');
  const { isSilkaError } = await import('../src/silka/codemode/errors.mjs');
  const dispatch = createApiDispatcher({
    workspace: os.tmpdir(),
    callHub: async () => ({}),
    callBridgeTool: async () => '',
    listSessions: async () => [],
    ownTaskId: 'mia',
  });
  await assert.rejects(dispatch(['card'], ['otra']), (err) => isSilkaError(err) && err.code === 'E_POLICY');
  await assert.rejects(dispatch(['get'], ['log:otra#verify']), (err) => isSilkaError(err) && err.code === 'E_POLICY');
  // El intento rechazado queda en la auditoría con su regla y su tarea.
  const rows = fs.readFileSync(auditFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.rule === 'SEC-16' && r.taskId === 'mia' && r.action === 'codemode card'));
});

test('FR-AC-01: el bloqueo avisa al manager con una nota ligada a la tarea', async () => {
  const { managerNotes } = await import('../src/silka/notes.mjs');
  auditBlocked({ taskId: 'avisa', action: 'agent_session_create', rule: 'SEC-15', message: 'prueba aviso' });
  const { notes } = managerNotes({ sessionId: 'task:avisa', markRead: false });
  assert.ok(notes.some((n) => n.kind === 'contencion' && /SEC-15/.test(n.text)));
});

test('SEC-16: silka_state de una tarea no lista las tareas en curso de otras', async () => {
  const { formatBlock } = await import('../src/silka/state.mjs');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-state-'));
  try {
    fs.mkdirSync(path.join(ws, '.silka'));
    fs.writeFileSync(path.join(ws, '.silka', 'tasks.json'), JSON.stringify({
      tasks: [{ id: 'otra', status: 'running', agent: 'codex', pid: process.pid, createdAt: new Date().toISOString() }],
      conflicts: [],
    }));
    assert.match(formatBlock(ws), /en curso: codex/);
    assert.doesNotMatch(formatBlock(ws, { excludeTasks: true }), /en curso/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('AC-01 (1.1): un sub-agente de Codex arranca sin el servidor agent-rack; el manager no cambia', async () => {
  const { codexSubagentArgs } = await import('../shims/agent-shim.mjs');
  assert.deepEqual(codexSubagentArgs({ SILKA_DEPTH: '1' }), ['-c', 'mcp_servers.agent-rack.enabled=false']);
  assert.deepEqual(codexSubagentArgs({ SILKA_DEPTH: '2' }), ['-c', 'mcp_servers.agent-rack.enabled=false']);
  assert.deepEqual(codexSubagentArgs({}), []);
  assert.deepEqual(codexSubagentArgs({ SILKA_DEPTH: '0' }), []);
});

test('SEC-17: la lista de la config de Silka se lee con SILKA_CONFIG y cae a la de por defecto', async () => {
  const { silkaSecretDenylist } = await import('../src/silka/tasks/denylist.mjs');
  const cfg = path.join(silkaDataDir(), `cfg-${Date.now().toString(36)}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ secretDenylist: ['clave-*.txt'] }));
  const prev = process.env.SILKA_CONFIG;
  try {
    process.env.SILKA_CONFIG = cfg;
    assert.deepEqual(silkaSecretDenylist(), ['clave-*.txt']);
    fs.writeFileSync(cfg, '{ no json');
    assert.deepEqual(silkaSecretDenylist(), [...DEFAULT_SECRET_DENYLIST]);
  } finally {
    if (prev === undefined) delete process.env.SILKA_CONFIG; else process.env.SILKA_CONFIG = prev;
  }
});
