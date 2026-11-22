import test from 'node:test';
import assert from 'node:assert/strict';
import { harnessFreeEnv } from '../src/silka/hub.mjs';
import { createWorkspaceScanner } from '../src/silka/ui/scanner.mjs';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('TP-01 NODE_ENV que pone el TUI no llega a los agentes; el del usuario sí', () => {
  assert.deepEqual(harnessFreeEnv({ NODE_ENV: 'production', SILKA_UI_NODE_ENV: '1', PATH: 'p' }), { PATH: 'p' });
  assert.deepEqual(harnessFreeEnv({ NODE_ENV: 'development', PATH: 'p' }), { NODE_ENV: 'development', PATH: 'p' });
});

test('TP-02 el escaneo se espacia: no repite si nada cambió y no pasó el intervalo', async () => {
  let runs = 0;
  const scanner = createWorkspaceScanner({ everyMs: 10_000, inline: () => { runs += 1; return { hot: [], board: null, clear: true }; } });
  scanner.request({ dirs: [] }, 'a');
  await tick();
  scanner.request({ dirs: [] }, 'a');
  await tick();
  assert.equal(runs, 1);
  scanner.request({ dirs: [] }, 'b');
  await tick();
  assert.equal(runs, 2, 'un cambio de estado dispara el escaneo al instante');
  await scanner.close();
});

test('TP-03 el resultado llega y avisa para repintar', async () => {
  let updates = 0;
  const scanner = createWorkspaceScanner({ onUpdate: () => { updates += 1; }, inline: () => ({ hot: ['s1'], board: { x: 1 }, clear: false }) });
  scanner.request({ dirs: ['.'] }, 'a');
  await tick();
  assert.equal(updates, 1);
  assert.ok(scanner.latest().hot.has('s1'));
  assert.deepEqual(scanner.latest().board, { x: 1 });
  await scanner.close();
});

test('TP-04 el worker real escanea un repo sin bloquear y devuelve el tablero', async () => {
  let done;
  const ready = new Promise((r) => { done = r; });
  const scanner = createWorkspaceScanner({ onUpdate: () => done() });
  scanner.request({ dirs: [process.cwd()], sessions: [], selectedWorkspace: process.cwd() }, 'x');
  let spins = 0;
  const spin = setInterval(() => { spins += 1; }, 5);
  await Promise.race([ready, tick(20_000)]);
  clearInterval(spin);
  await scanner.close();
  assert.ok(scanner.latest().board, 'llegó el tablero del workspace');
  assert.ok(spins > 3, 'el hilo principal siguió libre mientras corría git');
});
