import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  isolatedOpencodeConfig,
  killTreeArgs,
  opencodeInvocation,
  repoTouched,
  restoreRepo,
  runBenchmark,
  runLimits,
  OPENCODE_TIMEOUT_MS,
} from '../scripts/benchmark/run.mjs';
import { writeReport } from '../scripts/benchmark/report.mjs';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Repo git temporal con un commit: el "repo principal" de la prueba. */
function tempRepo() {
  const dir = tmp('silka-bench-test-repo-');
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicio');
  return { dir, commit: git('rev-parse', 'HEAD').stdout.trim() };
}

test('procesos: taskkill cierra el árbol completo del PID de Node', () => {
  assert.deepEqual(killTreeArgs(4321), ['/PID', '4321', '/T', '/F']);
});

test('OpenCode: el camino solo corre con --standalone y config aislada', () => {
  const inv = opencodeInvocation({ model: 'opencode/hy4-flash-free', silka: false, title: 'bench-T1-solo', prompt: 'Hola "mundo"', configDir: '/cfg' });
  assert.match(inv.cmd, /--standalone/);
  assert.match(inv.cmd, /-m opencode\/hy4-flash-free/);
  assert.match(inv.cmd, /"Hola \\"mundo\\""/, 'las comillas del prompt se escapan');
  assert.equal(inv.env.XDG_CONFIG_HOME, '/cfg');
  assert.equal(inv.mode, 'standalone-config-aislada');
});

test('OpenCode: el camino con Silka usa el servicio global (sin --standalone, sin config aislada)', () => {
  const inv = opencodeInvocation({ model: 'opencode/hy4-flash-free', silka: true, title: 'bench-T1-silka', prompt: 'x' });
  assert.doesNotMatch(inv.cmd, /--standalone/);
  assert.equal(inv.env.XDG_CONFIG_HOME, process.env.XDG_CONFIG_HOME);
  assert.equal(inv.mode, 'servicio-global');
});

test('OpenCode: la config aislada no tiene MCP y vive fuera de la config del usuario', () => {
  const root = isolatedOpencodeConfig();
  try {
    const file = path.join(root, 'opencode', 'opencode.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(cfg.mcp, {});
    assert.equal(fs.existsSync(path.join(root, 'opencode', 'AGENTS.md')), false, 'no hay AGENTS.md global');
    assert.ok(path.basename(root).startsWith('silka-bench-cfg-'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('guarda: un repo sin cambios no está tocado; con un archivo nuevo sí, y restoreRepo lo deja limpio con parche', () => {
  const { dir } = tempRepo();
  try {
    assert.equal(repoTouched(dir), false);
    fs.writeFileSync(path.join(dir, 'nuevo.txt'), 'agente\n');
    assert.equal(repoTouched(dir), true);
    const patch = path.join(tmp('silka-bench-test-patch-'), 'p.patch');
    restoreRepo(dir, patch);
    assert.equal(repoTouched(dir), false);
    assert.equal(fs.existsSync(path.join(dir, 'nuevo.txt')), false);
    assert.match(fs.readFileSync(patch, 'utf8'), /nuevo\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guarda: si el agente escribe en el repo principal, la tarea queda inválida y sin calidad', async () => {
  const { dir: repo, commit } = tempRepo();
  const work = tmp('silka-bench-test-work-');
  const task = { id: 'TX', title: 't', alcance: 'a', entregable: 'e', permitidos: ['a.txt'], verify: 'exit 0' };
  try {
    const runners = {
      // Simula un agente que escribe en el repo principal en vez de en su worktree.
      solo: async () => { fs.writeFileSync(path.join(repo, 'fuera.txt'), 'x\n'); return { stdout: '', verify: true, changedFiles: [] }; },
      silka: async () => ({ stdout: '', verify: true, changedFiles: [] }),
    };
    const r = await runBenchmark({
      commit, tasks: [task], tasksHash: 'h', runners,
      workdirFor: async () => ({ dir: work, cleanup: async () => {} }),
      now: new Date('2026-11-22T12:00:00Z'), repo,
    });
    const inv = r.solo[0];
    assert.match(inv.invalid, /repo principal quedó con cambios/);
    assert.equal(inv.quality.verify, null, 'la calidad de una tarea inválida no cuenta');
    assert.equal(repoTouched(repo), false, 'el repo principal queda limpio');
    assert.equal(r.silka[0].invalid, undefined, 'la otra tarea sigue válida');
    assert.equal(r.silka[0].quality.verify, true);
    const patch = inv.invalid.match(/guardado en (.+)\)$/)?.[1];
    if (patch && fs.existsSync(patch)) fs.rmSync(patch, { force: true });
    assert.match(r.markdown, /Tareas inválidas/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('límites: tareas inválidas y topes de tiempo se declaran en el informe', () => {
  const lines = runLimits([
    { taskId: 'T1', path: 'solo', invalid: 'x' },
    { taskId: 'T2', path: 'silka', timedOut: true },
    { taskId: 'T3', path: 'solo' },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /T1 \(solo\)/);
  assert.match(lines[1], new RegExp(`${OPENCODE_TIMEOUT_MS / 60000} minutos`));
  assert.deepEqual(runLimits([{ taskId: 'T1', path: 'solo' }]), []);
});

test('informe: nunca sobrescribe un informe del mismo día', () => {
  const dir = tmp('silka-bench-test-reports-');
  try {
    const a = writeReport(dir, '2026-11-22', 'primero');
    const b = writeReport(dir, '2026-11-22', 'segundo');
    assert.equal(path.basename(a), '2026-11-22.md');
    assert.equal(path.basename(b), '2026-11-22-2.md');
    assert.equal(fs.readFileSync(a, 'utf8'), 'primero');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
