import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withDetachedWorktree } from '../src/silka/integration/worktree.mjs';
import { gitRun } from '../src/silka/tasks/git.mjs';
import { inferSetupCommands } from '../src/silka/tasks/infer-setup.mjs';
import { runSetupWithEvidence, tryLinkNodeModules } from '../src/silka/tasks/setup.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { isNodeModulesLink, prepareWorktreeRemoval } from '../src/silka/tasks/worktree-cleanup.mjs';
import { removeTaskWorktree } from '../src/silka/tasks/worktree.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-setup-'));
  gitRun(dir, ['init', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 't@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n');
  gitRun(dir, ['add', '.']);
  gitRun(dir, ['commit', '-m', 'base']);
  return dir;
}

test('setup inferido: package-lock.json → npm ci', () => {
  const dir = initRepo();
  assert.deepEqual(inferSetupCommands(dir), ['npm ci']);
  fs.unlinkSync(path.join(dir, 'package-lock.json'));
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 5\n');
  assert.deepEqual(inferSetupCommands(dir), ['pnpm install --frozen-lockfile']);
});

test('setup link: enlace y borrado seguro dejan node_modules principal intacto', () => {
  const repo = initRepo();
  const sentinel = path.join(repo, 'node_modules', '.silka-sentinel');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, 'keep-me\n');

  withDetachedWorktree(repo, gitRun(repo, ['rev-parse', 'HEAD'], { repoRoot: repo }).stdout.trim(), (wt) => {
    const link = tryLinkNodeModules(repo, wt);
    assert.equal(link.ok, true);
    assert.equal(link.linked, true);
    assert.ok(isNodeModulesLink(path.join(wt, 'node_modules')));
    assert.ok(fs.existsSync(path.join(wt, 'node_modules', '.silka-sentinel')));
    prepareWorktreeRemoval(repo, wt);
    assert.ok(!fs.existsSync(path.join(wt, 'node_modules')));
    assert.ok(fs.existsSync(sentinel), 'el junction no debe vaciar node_modules del repo');
    assert.ok(fs.readFileSync(sentinel, 'utf8').includes('keep-me'));
    return true;
  }, { tag: 'link' });
});

test('fallo de setup queda en evidence como kind setup', async () => {
  const repo = initRepo();
  const mgr = createTaskManager(repo);
  await mgr.launch([{
    id: 'setup-fail',
    title: 'setup falla',
    scope: 'x',
    deliver: 'nada',
    verify: 'node -e "process.exit(0)"',
    setup: 'node -e "process.exit(2)"',
  }], { manual: true });
  await mgr.runAgentTurn('setup-fail', async (cwd) => { fs.writeFileSync(path.join(cwd, 'x.txt'), 'x'); });
  const t = mgr.list().find((x) => x.id === 'setup-fail');
  assert.equal(t.state, STATES.VERIFICACION_FALLIDA);
  const setupEv = (t.card?.evidence || []).filter((e) => e.kind === 'setup');
  assert.equal(setupEv.length, 1);
  assert.equal(setupEv[0].ok, false);
  assert.equal(setupEv[0].exitCode, 2);
  removeTaskWorktree(repo, 'setup-fail');
});