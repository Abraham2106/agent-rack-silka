import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkAgentClis, checkHubs, checkNode, checkRepoRegistry, checkRunningCodeAge, checkSizes,
  checkWorktrees, checkWorktreesAllowed, coversPath, findInPath, isBrokenLink,
} from '../src/silka/doctor/checks.mjs';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `silka-dr-${label}-`));

/** Contexto falso: nada de procesos, puertos ni config reales. Se sobrescribe lo que cada prueba mira. */
function fakeCtx(over = {}) {
  const configDir = tmp('cfg');
  return {
    root: tmp('root'),
    env: { PATH: '' },
    home: tmp('home'),
    nodeVersion: 'v22.0.0',
    defaultPort: 8987,
    configDir,
    loadConfig: () => ({ port: 8987, config: { agents: {} } }),
    worktreesRoot: () => path.join(tmp('data'), 'wt'),
    listProcesses: () => [],
    startOf: () => null,
    probePort: async () => true,
    lastChangeMs: () => null,
    repos: () => [],
    worktreeTools: { listTaskRepos: () => [], worktreesBase: () => '' },
    taskWorktrees: () => [],
    ...over,
  };
}

const node = (pid, commandLine) => ({ pid, name: 'node.exe', commandLine });

test('DR-01a la carpeta de worktrees no cubierta por la config efectiva es falla', async () => {
  const ctx = fakeCtx();
  fs.writeFileSync(path.join(ctx.configDir, 'agent-rack.effective-8987.json'), JSON.stringify({ allowedWorkspaces: ['/otra/carpeta'] }));
  const p = await checkWorktreesAllowed(ctx);
  assert.equal(p.status, 'falla');
  assert.match(p.cause, /allowedWorkspaces/);
  assert.ok(p.fix);
});

test('DR-01b cubierta por la config efectiva es ok; sin config efectiva es aviso', async () => {
  const wt = path.join(tmp('data'), 'wt');
  const ctx = fakeCtx({ worktreesRoot: () => wt });
  assert.equal((await checkWorktreesAllowed(ctx)).status, 'aviso', 'el hub aún no ha escrito la config');
  fs.writeFileSync(path.join(ctx.configDir, 'agent-rack.effective-8987.json'), JSON.stringify({ allowedWorkspaces: [path.dirname(wt)] }));
  assert.equal((await checkWorktreesAllowed(ctx)).status, 'ok');
});

test('DR-01c coversPath: igual o dentro de una permitida, nunca un prefijo parcial', () => {
  assert.equal(coversPath(['/a/b'], '/a/b'), true);
  assert.equal(coversPath(['/a/b'], '/a/b/c'), true);
  assert.equal(coversPath(['/a/b'], '/a/bc'), false);
});

test('DR-01d Node menor que 20 es falla', () => {
  assert.equal(checkNode(fakeCtx({ nodeVersion: 'v18.19.0' })).status, 'falla');
  assert.equal(checkNode(fakeCtx({ nodeVersion: 'v20.11.0' })).status, 'ok');
});

test('DR-02a varios hubs vivos: falla con los pids', async () => {
  const ctx = fakeCtx({ listProcesses: () => [node(101, '"node.exe" "C:\\x\\cli.mjs" hub'), node(202, '"node.exe" "C:\\x\\cli.mjs" hub')] });
  const p = await checkHubs(ctx);
  assert.equal(p.status, 'falla');
  assert.match(p.cause, /101/);
  assert.match(p.cause, /202/);
});

test('DR-02b un hub vivo que no responde es falla; ninguno es aviso', async () => {
  const one = [node(101, '"node.exe" "C:\\x\\cli.mjs" hub')];
  assert.equal((await checkHubs(fakeCtx({ listProcesses: () => one, probePort: async () => false }))).status, 'falla');
  assert.equal((await checkHubs(fakeCtx({ listProcesses: () => one, probePort: async () => true }))).status, 'ok');
  assert.equal((await checkHubs(fakeCtx())).status, 'aviso');
});

test('DR-03 un bridge que arrancó antes del último cambio es aviso; uno nuevo es ok', async () => {
  const procs = [node(303, '"node.exe" "C:\\x\\cli.mjs" bridge')];
  const old = await checkRunningCodeAge(fakeCtx({ listProcesses: () => procs, lastChangeMs: () => 2_000_000, startOf: () => 1_000_000 }));
  const bridge = old.find((p) => p.id === 'bridge');
  assert.equal(bridge.status, 'aviso');
  assert.match(bridge.cause, /303/);
  assert.match(bridge.fix, /reconecta el MCP|sesión nueva/);
  const fresh = await checkRunningCodeAge(fakeCtx({ listProcesses: () => procs, lastChangeMs: () => 2_000_000, startOf: () => 3_000_000 }));
  assert.equal(fresh.find((p) => p.id === 'bridge').status, 'ok');
});

test('DR-02c un proceso que solo se llama cli.mjs sin el rol no cuenta como hub', async () => {
  const procs = [node(1, '"node.exe" "C:\\x\\cli.mjs" ls'), { pid: 2, name: 'cmd.exe', commandLine: 'cmd /c start "silka hub" cli.mjs hub' }];
  assert.equal((await checkHubs(fakeCtx({ listProcesses: () => procs }))).status, 'aviso');
});

test('AG-01 CLI de agente ausente en el PATH de prueba es falla; con PATH de prueba y sesión es ok', async () => {
  const bin = tmp('bin');
  fs.writeFileSync(path.join(bin, 'codex'), '');
  const home = tmp('home');
  const config = { agents: {
    codex: { command: 'node', args: ['shim.mjs', 'codex'] },
    opencode: { command: 'node', args: ['shim.mjs', 'opencode'] },
  } };
  const ctx = fakeCtx({ env: { PATH: bin }, home, loadConfig: () => ({ port: 8987, config }) });
  const sinSesion = await checkAgentClis(ctx);
  const codexP = sinSesion.find((p) => p.id === 'cli-codex');
  assert.equal(codexP.status, 'falla', 'instalada pero sin credenciales');
  assert.equal(sinSesion.find((p) => p.id === 'cli-opencode').status, 'falla', 'no instalada');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const conSesion = await checkAgentClis(ctx);
  assert.equal(conSesion.find((p) => p.id === 'cli-codex').status, 'ok');
});

test('AG-02 findInPath encuentra el ejecutable solo en los directorios dados', () => {
  const bin = tmp('path');
  fs.writeFileSync(path.join(bin, 'mi-cli'), '');
  assert.ok(findInPath('mi-cli', { PATH: bin }));
  assert.equal(findInPath('mi-cli', { PATH: tmp('vacio') }), null);
});

test('WT-01 worktrees huérfanos y enlaces de node_modules rotos', () => {
  const repo = tmp('repo');
  const base = tmp('base');
  const used = path.join(base, 'tk-usado');
  const orphan = path.join(base, 'tk-huerfano');
  fs.mkdirSync(used);
  fs.mkdirSync(orphan);
  // Enlace roto: junction a un destino que ya no existe.
  const gone = tmp('gone');
  fs.symlinkSync(gone, path.join(orphan, 'node_modules'), 'junction');
  fs.rmSync(gone, { recursive: true, force: true });
  assert.equal(isBrokenLink(path.join(orphan, 'node_modules')), true);

  const ctx = fakeCtx({
    worktreeTools: { listTaskRepos: () => [repo], worktreesBase: () => base },
    taskWorktrees: () => [used],
  });
  const [orphanP, linkP] = checkWorktrees(ctx);
  assert.equal(orphanP.status, 'aviso');
  assert.match(orphanP.name, /\(1\)/);
  assert.equal(linkP.status, 'aviso');
  assert.match(linkP.fix, /rmdir/);
  assert.doesNotMatch(linkP.fix, /rmdir \/s/, 'nunca sugiere borrar el destino con rmdir /s');
});

test('REG-01 registro con entradas que ya no existen es aviso; limpio es ok', () => {
  const real = tmp('repo');
  fs.mkdirSync(path.join(real, '.silka', 'tasks-v1'), { recursive: true });
  assert.equal(checkRepoRegistry(fakeCtx({ repos: () => [real] })).status, 'ok');
  const p = checkRepoRegistry(fakeCtx({ repos: () => [real, path.join(tmp('x'), 'borrado')] }));
  assert.equal(p.status, 'aviso');
  assert.match(p.cause, /1 de 2/);
});

test('SZ-01 notas y logs pequeños son ok', () => {
  const ctx = fakeCtx();
  fs.writeFileSync(path.join(ctx.configDir, 'notes.jsonl'), '{}\n');
  for (const p of checkSizes(ctx)) assert.equal(p.status, 'ok');
});
