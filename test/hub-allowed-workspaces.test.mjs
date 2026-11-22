// BUG-08: agent-rack rechazaba crear la sesión en el worktree de la tarea porque la carpeta de
// worktrees de Silka no estaba en allowedWorkspaces. El hub le pasa una config efectiva que la
// agrega (y nada más). La prueba real contra agent-rack está en scripts/e2e-worktree-session.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { effectiveAgentRackConfig, silkaWorktreesRoot, writeEffectiveAgentRackConfig } from '../src/silka/hub.mjs';
import { worktreePath } from '../src/silka/tasks/worktree.mjs';

const user = { port: 8987, allowedWorkspaces: ['C:/Users/x/Documents/Development'], agents: { codex: { command: 'node' } } };

test('AW-01 la config efectiva agrega solo la carpeta de worktrees de Silka', () => {
  const eff = effectiveAgentRackConfig(user);
  assert.deepEqual(eff.allowedWorkspaces, [...user.allowedWorkspaces, silkaWorktreesRoot()]);
  assert.deepEqual(eff.agents, user.agents, 'el resto de la config no cambia');
  assert.deepEqual(user.allowedWorkspaces, ['C:/Users/x/Documents/Development'], 'la config del usuario no se muta');
});

test('AW-02 si la carpeta ya está cubierta por una ruta permitida, no se agrega nada', () => {
  const covered = { ...user, allowedWorkspaces: [path.dirname(silkaWorktreesRoot())] };
  assert.equal(effectiveAgentRackConfig(covered), covered);
});

test('AW-03 el worktree de cualquier tarea queda dentro de una ruta permitida de la config efectiva', () => {
  const eff = effectiveAgentRackConfig(user);
  const wt = path.resolve(worktreePath(process.cwd(), 'tk-cualquiera'));
  const norm = (p) => path.resolve(p).replaceAll('\\', '/').toLowerCase();
  assert.ok(eff.allowedWorkspaces.some((w) => norm(wt).startsWith(`${norm(w)}/`)), `${wt} no está permitido`);
});

test('AW-04 la config efectiva se escribe aparte, sin tocar el archivo del usuario', () => {
  const file = writeEffectiveAgentRackConfig(user, 18997);
  assert.ok(fs.existsSync(file));
  assert.ok(!file.endsWith('agent-rack.config.json'));
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).allowedWorkspaces.includes(silkaWorktreesRoot()));
});
