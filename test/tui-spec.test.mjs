// Escenarios TP-01..TP-04 de openspec/specs/tui/spec.md, comprobados contra la API pública.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harnessFreeEnv } from '../src/silka/hub.mjs';
import { createWorkspaceScanner } from '../src/silka/ui/scanner.mjs';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('TP-01 harnessFreeEnv quita el NODE_ENV del TUI y conserva el del usuario', () => {
  const tui = { NODE_ENV: 'production', SILKA_UI_NODE_ENV: '1', PATH: 'p', HOME: 'h' };
  assert.deepEqual(harnessFreeEnv(tui), { PATH: 'p', HOME: 'h' });
  assert.deepEqual(harnessFreeEnv({ NODE_ENV: 'development', PATH: 'p' }), { NODE_ENV: 'development', PATH: 'p' });
  assert.deepEqual(harnessFreeEnv({ PATH: 'p' }), { PATH: 'p' });
  assert.equal(harnessFreeEnv(tui).NODE_ENV, undefined, 'el entorno del harness no se filtra a los agentes');
});

test('TP-02 el escaneo se espacia por estado y por tiempo, sin repetir el git completo', async () => {
  let runs = 0;
  const scanner = createWorkspaceScanner({
    everyMs: 60,
    inline: () => { runs += 1; return { hot: [], board: null, clear: true }; },
  });
  scanner.request({ dirs: [] }, 'a');
  await tick(15);
  scanner.request({ dirs: [] }, 'a');
  await tick(15);
  assert.equal(runs, 1, 'mismo estado dentro del intervalo: un solo escaneo');
  scanner.request({ dirs: [] }, 'b');
  await tick(15);
  assert.equal(runs, 2, 'cambio de estado: escaneo inmediato');
  await tick(75);
  scanner.request({ dirs: [] }, 'b');
  await tick(15);
  assert.equal(runs, 3, 'vencido el intervalo: se vuelve a escanear aunque no cambiara el estado');
  await scanner.close();
});

test('TP-03 cada resultado avisa para repintar y deja los datos del tablero en latest()', async () => {
  const updates = [];
  const scanner = createWorkspaceScanner({
    onUpdate: () => updates.push({ hot: [...scanner.latest().hot], board: scanner.latest().board, clear: scanner.latest().clear }),
    inline: () => ({ hot: ['s1', 's2'], board: { tasks: [], conflicts: [] }, clear: false }),
  });
  scanner.request({ dirs: ['.'] }, 'a');
  await tick();
  assert.equal(updates.length, 1, 'el resultado dispara exactamente una actualización');
  assert.deepEqual(updates[0].hot, ['s1', 's2']);
  assert.deepEqual(updates[0].board, { tasks: [], conflicts: [] });
  assert.equal(updates[0].clear, false);
  assert.deepEqual([...scanner.latest().hot], ['s1', 's2'], 'latest() expone el tablero para el repintado');
  await scanner.close();
});

test('TP-04 el worker escanea en background y el hilo principal sigue respondiendo', async () => {
  let ready;
  const scanned = new Promise((resolve) => { ready = resolve; });
  const scanner = createWorkspaceScanner({ onUpdate: ready });
  scanner.request({ dirs: [process.cwd()], sessions: [], selectedWorkspace: process.cwd() }, 'worker');

  let spins = 0;
  const spinner = setInterval(() => { spins += 1; }, 5);
  let timeout;
  const deadline = new Promise((resolve) => { timeout = setTimeout(resolve, 15_000); });
  await Promise.race([scanned, deadline]);
  clearTimeout(timeout);
  clearInterval(spinner);
  await scanner.close();

  assert.ok(spins > 3, 'el event loop siguió atendiendo eventos durante el escaneo en el worker');
  assert.ok(scanner.latest().board, 'llegó el tablero del workspace escaneado en background');
});
