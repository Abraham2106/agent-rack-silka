// Punto 4 del plan: `silka hub` se cerraba solo en una terminal. Causas reproducidas:
// el runtime de agent-rack quedaba de antes con un pid ahora de otro proceso, o agent-rack seguía
// vivo sin hub (huérfano); en ambos casos `silka hub` decía "ya está en marcha" y salía.
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveParentCommandLine, runtimeAlive } from '../src/silka/hub.mjs';

const created = '2026-11-21T22:26:12.079Z';
const createdMs = Date.parse(created);

test('runtimeAlive: el pid de un runtime viejo que ahora es de otro proceso no cuenta', () => {
  // explorer.exe (o cualquiera) con ese pid, arrancado después de escrito el runtime.
  assert.equal(runtimeAlive({ pid: process.pid, createdAt: created }, { startOf: () => createdMs + 3_600_000 }), false);
  // ...o mucho antes (días): tampoco es el agent-rack que escribió el archivo.
  assert.equal(runtimeAlive({ pid: process.pid, createdAt: '2026-11-21T22:26:13.000Z' }, { startOf: () => createdMs - 86_400_000 }), false);
});

test('runtimeAlive: el agent-rack que escribió el runtime sí cuenta', () => {
  assert.equal(runtimeAlive({ pid: process.pid, createdAt: '2026-11-21T22:26:14.000Z' }, { startOf: () => createdMs - 2_000 }), true);
  assert.equal(runtimeAlive({ pid: 999999, createdAt: created }, { startOf: () => createdMs }), false, 'pid muerto');
  assert.equal(runtimeAlive(null), false);
  // Sin hora de inicio disponible se confía en el pid, como antes.
  assert.equal(runtimeAlive({ pid: process.pid, createdAt: '2026-11-21T22:26:15.000Z' }, { startOf: () => null }), true);
});

test('liveParentCommandLine: ve el proceso padre vivo (para no adoptar el agent-rack de otro hub)', () => {
  const parent = liveParentCommandLine(process.pid);
  assert.ok(parent.length > 0, 'el padre de esta prueba está vivo');
  assert.equal(liveParentCommandLine(999999), '');
});
