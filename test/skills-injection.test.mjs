// role-skills 2.2: las skills del rol y alcance de la tarea van en el payload de agent_session_create,
// junto a la memoria y antes del encargo. Hub falso: solo registra lo que recibe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';

const OK = 'node -e "process.exit(0)"';

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-skills-inj-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, 'src', 'silka', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'silka', 'ui', 'a.txt'), 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  return dir;
}

function writeRepoSkill(repo, role, fileName, text) {
  const dir = path.join(repo, '.silka', 'skills', role);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), text);
}

test('RS-02 (2.2): el payload del agente lleva la skill del rol implementador para su alcance', async () => {
  const repo = initRepo();
  writeRepoSkill(repo, 'implementador', 'ui.md',
    '---\nrol: implementador\nalcance: src/silka/ui/\n---\nREGLA-UI-RS: no tocar el render sin prueba.\n');
  writeRepoSkill(repo, 'revisor', 'rev.md',
    '---\nrol: revisor\nalcance: src/silka/ui/\n---\nREGLA-REVISOR-RS: solo revisa.\n');
  const mgr = createTaskManager(repo);
  const payloads = [];
  const fakeHub = async (name, payload) => {
    if (name === 'agent_session_create') {
      payloads.push(payload);
      return JSON.stringify({ sessionId: 'sess-rs-1' });
    }
    return JSON.stringify({ ok: true });
  };
  await mgr.launch([{
    id: 'rs-ui', title: 'ui', scope: 'src/silka/ui/', deliver: 'x', verify: OK, role: 'implementar',
  }], { callHub: fakeHub, manual: false, deferStart: true });
  const logs = [];
  await mgr.startPendingSessions({ callHub: fakeHub, defaultAgent: 'codex', log: (m) => logs.push(m) });

  assert.equal(payloads.length, 1, `una sesión creada; estado=${JSON.stringify(mgr.list().map((t) => [t.state, t.awaitingHubSession, t.worktreePath, t.startError]))} logs=${JSON.stringify(logs)}`);
  const prompt = payloads[0].prompt;
  assert.match(prompt, /Skills del rol implementador/);
  assert.match(prompt, /REGLA-UI-RS/);
  assert.doesNotMatch(prompt, /REGLA-REVISOR-RS/, 'no entra la skill de revisor');
  assert.ok(prompt.indexOf('REGLA-UI-RS') < prompt.indexOf('Entregar: x'), 'la skill va antes del encargo');
});
