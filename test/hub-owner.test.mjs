// BUG-04: un solo hub por puerto (dueño registrado con pid + hora de inicio, candado de arranque).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import {
  claimHubOwnership,
  hubOwnerAlive,
  hubOwnerPath,
  readHubOwner,
  releaseHubOwnership,
  shouldSpawnHub,
} from '../src/silka/hub-owner.mjs';

const OWNER_URL = new URL('../src/silka/hub-owner.mjs', import.meta.url).href;

/** Corre un trozo de código en otro proceso node (mismo SILKA_CONFIG_DIR) y devuelve su salida. */
function runChild(code, { keepAliveMs = 0 } = {}) {
  const body = `import * as o from ${JSON.stringify(OWNER_URL)};\n${code}\n${keepAliveMs ? `setTimeout(() => {}, ${keepAliveMs});` : ''}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', body], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const firstLine = new Promise((resolve) => {
    child.stdout.on('data', () => { if (out.includes('\n')) resolve(out.trim()); });
    child.on('exit', () => resolve(out.trim() || `(salió sin salida) ${err}`));
  });
  const exit = new Promise((resolve) => child.on('exit', () => resolve({ out: out.trim(), err })));
  // Si el hijo muere sin imprimir, la primera línea es su error (la prueba falla con el motivo).
  exit.then((r) => r.err && console.error(r.err));
  return { child, firstLine, exit };
}

let port = 41000;
const nextPort = () => { port += 1; return port; };

test('BUG-04: un segundo hub no puede reclamar el puerto mientras el primero vive', async () => {
  const p = nextPort();
  const first = runChild(`console.log(JSON.stringify(o.claimHubOwnership(${p})));`, { keepAliveMs: 30_000 });
  assert.match(await first.firstLine, /"ok":true/);
  const second = claimHubOwnership(p);
  assert.equal(second.ok, false);
  assert.equal(second.owner.pid, first.child.pid);
  first.child.kill();
  await first.exit;
  // Muerto el primero, el puerto queda libre.
  assert.equal(claimHubOwnership(p).ok, true);
  releaseHubOwnership(p);
  assert.equal(readHubOwner(p), null);
});

test('BUG-04: dueño con pid muerto o reutilizado no cuenta como vivo', () => {
  const ownStart = Math.round(Date.now() - process.uptime() * 1000);
  assert.equal(hubOwnerAlive({ pid: 999999, startedAt: ownStart }), false);
  // pid vivo (otro proceso) pero con otra hora de inicio: es otro proceso que reusó el pid.
  assert.equal(hubOwnerAlive({ pid: 4242, startedAt: 1000 }, { startOf: () => 9_999_999 }), false);
  assert.equal(hubOwnerAlive({ pid: process.pid, startedAt: ownStart }), true);
  const p = nextPort();
  fs.writeFileSync(hubOwnerPath(p), JSON.stringify({ pid: 999999, startedAt: 1, port: p }));
  assert.equal(claimHubOwnership(p).ok, true, 'un registro de un hub muerto se reemplaza');
  assert.equal(readHubOwner(p).pid, process.pid);
  releaseHubOwnership(p);
});

test('BUG-04: varios hubs que arrancan a la vez → exactamente uno reclama el puerto', async () => {
  const p = nextPort();
  const kids = Array.from({ length: 6 }, () => runChild(`console.log(JSON.stringify(o.claimHubOwnership(${p})));`, { keepAliveMs: 15_000 }));
  const results = await Promise.all(kids.map((k) => k.firstLine));
  assert.equal(results.filter((r) => /"ok":true/.test(r)).length, 1, results.join('\n'));
  for (const k of kids) k.child.kill();
  await Promise.all(kids.map((k) => k.exit));
});

test('BUG-04: varios clientes en ensureHub a la vez → solo uno lanza el hub', async () => {
  const p = nextPort();
  const kids = Array.from({ length: 6 }, () => runChild(`console.log(String(o.shouldSpawnHub(${p})));`));
  const results = (await Promise.all(kids.map((k) => k.exit))).map((r) => r.out);
  assert.equal(results.filter((r) => r === 'true').length, 1, results.join(','));
  // Pasado el plazo de gracia sin que el hub se registre, otro cliente puede volver a lanzarlo.
  assert.equal(shouldSpawnHub(p, { now: () => Date.now() + 25_000 }), true);
});

test('BUG-04: con un dueño vivo registrado, ensureHub espera en vez de lanzar otro', () => {
  const p = nextPort();
  assert.equal(claimHubOwnership(p).ok, true);
  assert.equal(shouldSpawnHub(p), false);
  releaseHubOwnership(p);
  assert.equal(shouldSpawnHub(p, { isAlive: () => true }), false, 'si el hub ya responde, no se lanza');
});
