import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const selfPath = fileURLToPath(import.meta.url);
const workerModes = new Set(['cc-lock', 'cc-atomic-reader', 'cc-atomic-writer', 'cc-model']);

async function runWorkers(mode, count, args) {
  const children = [];
  const exits = [];
  for (let i = 0; i < count; i += 1) {
    const child = fork(selfPath, [mode, ...args, String(i)], { stdio: 'inherit' });
    children.push(child);
    exits.push(new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1))));
  }
  const codes = await Promise.all(exits);
  assert.ok(codes.every((code) => code === 0), `worker ${mode} failed: ${codes.join(',')}`);
}

if (workerModes.has(process.argv[2])) {
  const mode = process.argv[2];
  const { withFileLock, writeAtomic, readJsonRetry, lockHolderDead } = await import('../src/silka/lock.mjs');
  const { noteModelError, unavailableModels } = await import('../src/silka/models.mjs');
  if (mode === 'cc-lock') {
    const lockPath = process.argv[3];
    const statsPath = process.argv[4];
    withFileLock(lockPath, () => {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      stats.inside += 1;
      stats.max = Math.max(stats.max, stats.inside);
      fs.writeFileSync(statsPath, JSON.stringify(stats));
      const end = Date.now() + 40;
      while (Date.now() < end) { /* sección crítica */ }
      const again = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      again.inside -= 1;
      fs.writeFileSync(statsPath, JSON.stringify(again));
    });
    process.exit(0);
  }
  if (mode === 'cc-atomic-writer') {
    const file = process.argv[3];
    const rounds = Number(process.argv[4]);
    for (let n = 0; n < rounds; n += 1) {
      writeAtomic(file, `${JSON.stringify({ n })}\n`);
    }
    process.exit(0);
  }
  if (mode === 'cc-atomic-reader') {
    const file = process.argv[3];
    const marker = process.argv[4];
    const budget = Number(process.argv[5]);
    let misses = 0;
    const stopAt = Date.now() + budget;
    while (Date.now() < stopAt) {
      const parsed = readJsonRetry(file, { retries: 1, fallback: null });
      if (!parsed || typeof parsed.n !== 'number') misses += 1;
      else fs.writeFileSync(marker, String(parsed.n));
    }
    if (misses) process.exit(2);
    process.exit(0);
  }
  if (mode === 'cc-model') {
    process.env.SILKA_CONFIG_DIR = process.argv[3];
    const agent = 'cursor';
    const model = process.argv[4];
    noteModelError(agent, model, 'model not supported');
    process.exit(0);
  }
}

function tmpRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  process.env.SILKA_CONFIG_DIR = dir;
  return dir;
}

test('T-CC-01 robo de lock rancio: a lo sumo uno en la sección crítica', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cc01-'));
  const lockPath = path.join(dir, 'race.lock');
  const statsPath = path.join(dir, 'stats.json');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 1 }));
  fs.utimesSync(lockPath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  fs.writeFileSync(statsPath, JSON.stringify({ inside: 0, max: 0 }));
  const { lockHolderDead } = await import('../src/silka/lock.mjs');
  assert.equal(lockHolderDead(lockPath), true);
  await runWorkers('cc-lock', 20, [lockPath, statsPath]);
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  assert.equal(stats.max, 1);
});

test('T-CC-02 escritura atómica: el lector no ve ausencia como vacío', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cc02-'));
  const file = path.join(dir, 'store.json');
  const marker = path.join(dir, 'last.txt');
  const { writeAtomic } = await import('../src/silka/lock.mjs');
  writeAtomic(file, `${JSON.stringify({ n: 0 })}\n`);
  const reader = fork(selfPath, ['cc-atomic-reader', file, marker, '2500'], { stdio: 'inherit' });
  const writer = fork(selfPath, ['cc-atomic-writer', file, process.platform === 'win32' ? '1000' : '400'], { stdio: 'inherit' });
  const codes = await Promise.all([
    new Promise((resolve) => reader.on('exit', (code) => resolve(code ?? 1))),
    new Promise((resolve) => writer.on('exit', (code) => resolve(code ?? 1))),
  ]);
  assert.equal(codes[0], 0);
  assert.equal(codes[1], 0);
  assert.ok(fs.existsSync(marker));
});

test('T-CC-03 PID reutilizado: otra hora de inicio cuenta como rancio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cc03-'));
  const lockPath = path.join(dir, 'pid.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: 1 }));
  const { lockHolderDead } = await import('../src/silka/lock.mjs');
  // Recién renovado: vivo, aunque la hora de inicio no cuadre (el dueño lo renueva cada segundo).
  assert.equal(lockHolderDead(lockPath), false);
  // Dejó de renovarse y el PID vivo tiene otra hora de inicio: PID reutilizado → rancio.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);
  assert.equal(lockHolderDead(lockPath), true);
});

test('T-CC-04 marcas de modelos no disponibles no se pierden', async () => {
  const dir = tmpRoot('silka-cc04-');
  const jobs = Array.from({ length: 10 }, (_, i) => `model-${i}`);
  const children = jobs.map((model, i) => fork(selfPath, ['cc-model', dir, model, String(i)], { stdio: 'inherit' }));
  const codes = await Promise.all(children.map((child) => new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)))));
  assert.ok(codes.every((code) => code === 0));
  const { unavailableModels } = await import('../src/silka/models.mjs');
  const bad = unavailableModels().cursor || {};
  for (const model of jobs) assert.ok(bad[model], `falta ${model}`);
});

test('T-CC-05 interrupción a un turno terminado no afecta otro con el mismo PID', async () => {
  const dir = tmpRoot('silka-cc05-');
  const sharedPid = 424242;
  const {
    writeInterrupt, readInterrupt, clearInterrupt, interruptPath,
  } = await import('../src/silka/interrupt.mjs');
  clearInterrupt('turn-done');
  clearInterrupt('turn-live');
  writeInterrupt({
    turnId: 'turn-done',
    pid: sharedPid,
    sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    text: 'vieja orden',
    author: 'tú',
  });
  const stale = readInterrupt('turn-done');
  assert.equal(stale.turnId, 'turn-done');
  const livePath = interruptPath('turn-live');
  assert.equal(fs.existsSync(livePath), false);
  assert.equal(readInterrupt('turn-live'), null);
});

test('T-CC-06 dos sesiones del mismo agente: la interrupción va al turno correcto', async () => {
  const dir = tmpRoot('silka-cc06-');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cc06-ws-'));
  const sidA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const sidB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const {
    writeSessionTurnLink, turnForSession, writeInterrupt, readInterrupt, clearInterrupt,
  } = await import('../src/silka/interrupt.mjs');
  const { sendToSession } = await import('../src/silka/commands.mjs');
  writeSessionTurnLink({ sessionId: sidA, turnId: 'turn-a', workspace: ws });
  writeSessionTurnLink({ sessionId: sidB, turnId: 'turn-b', workspace: ws });
  const sessionA = { sessionId: sidA, status: 'running', agentId: 'codex', workspace: ws, createdAt: new Date().toISOString() };
  const sessionB = { sessionId: sidB, status: 'running', agentId: 'codex', workspace: ws, createdAt: new Date().toISOString() };
  assert.equal(turnForSession(sessionA), 'turn-a');
  assert.equal(turnForSession(sessionB), 'turn-b');
  clearInterrupt('turn-a');
  clearInterrupt('turn-b');
  sendToSession(sessionA, { text: 'solo A', author: 'tú', now: true });
  const orderA = readInterrupt('turn-a');
  const orderB = readInterrupt('turn-b');
  assert.equal(orderA.text, 'solo A');
  assert.equal(orderB, null);
  clearInterrupt('turn-a');
  clearInterrupt('turn-b');
});