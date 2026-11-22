import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../src/silka/cli.mjs');

function runDoctor(args, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-doctor-cfg-'));
  return spawnSync(process.execPath, [cli, 'doctor', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      SILKA_CONFIG_DIR: dir,
      SILKA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'silka-doctor-data-')),
      // Config inexistente a propósito: el punto de configuración debe fallar, no tumbar el comando.
      SILKA_CONFIG: path.join(dir, 'no-existe.json'),
      ...env,
    },
  });
}

test('DR-05 silka doctor --json devuelve JSON válido con la falla y sale con código distinto de cero', () => {
  const r = runDoctor(['--json']);
  assert.notEqual(r.status, 0, 'con una falla, el código de salida no es cero');
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  const failed = parsed.points.filter((p) => p.status === 'falla');
  assert.ok(failed.length >= 1, 'hay al menos un punto en falla');
  assert.ok(failed.every((p) => p.cause && p.fix), 'cada falla trae causa y arreglo');
  assert.ok(parsed.points.some((p) => p.id === 'config' && p.status === 'falla'));
});

test('DR-06 sin --json la salida es texto con las causas y el resumen', () => {
  const r = runDoctor([]);
  assert.match(r.stdout, /FALLA/);
  assert.match(r.stdout, /arreglo:/);
  assert.match(r.stdout, /falla/);
});
