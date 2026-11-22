import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext } from '../src/silka/doctor/checks.mjs';
import { diagnose } from '../src/silka/doctor/index.mjs';
import { STATUS } from '../src/silka/doctor/result.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const doctorDir = path.resolve(here, '../src/silka/doctor');

/** Foto de un árbol: ruta relativa -> tamaño y hora de cambio. Sirve para ver si algo cambió. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { const st = fs.statSync(full); out[path.relative(dir, full)] = `${st.size}|${st.mtimeMs}`; }
    }
  };
  walk(dir);
  return out;
}

test('DR-04a doctor con fallas presentes no cambia archivos de config ni de datos', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-ro-cfg-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-ro-data-'));
  fs.writeFileSync(path.join(cfg, 'notes.jsonl'), '{"a":1}\n');
  fs.writeFileSync(path.join(cfg, 'task-repos.json'), JSON.stringify({ repos: [path.join(os.tmpdir(), 'no-existe-repo')] }));
  const before = { cfg: snapshot(cfg), data: snapshot(data) };
  const r = spawnSync(process.execPath, [path.resolve(here, '../src/silka/cli.mjs'), 'doctor', '--json'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, SILKA_CONFIG_DIR: cfg, SILKA_DATA_DIR: data, SILKA_CONFIG: path.join(cfg, 'no-existe.json') },
  });
  assert.notEqual(r.status, 0, 'hay fallas (falta la config)');
  assert.deepEqual({ cfg: snapshot(cfg), data: snapshot(data) }, before);
});

test('DR-04b doctor no mata ni arranca hubs ni bridges', async (t) => {
  // Aislado de la máquina: la tabla de procesos es simulada y process.kill se espía. Así el
  // resultado no depende de los hubs o bridges que otros agentes o sesiones tengan en marcha.
  // (El arranque y la terminación de procesos en el código de doctor se vigilan en DR-04c.)
  const cli = path.resolve(here, '../src/silka/cli.mjs');
  const procs = [
    { pid: 910001, name: 'node.exe', commandLine: `node "${cli}" hub` },
    { pid: 910002, name: 'node.exe', commandLine: `node "${cli}" bridge` },
  ];
  const before = JSON.stringify(procs);
  const signals = [];
  t.mock.method(process, 'kill', (pid, sig) => { signals.push({ pid, sig }); return true; });
  const ctx = await makeContext({ listProcesses: () => procs, probePort: async () => true });
  const { points } = await diagnose({ ctx });
  assert.equal(points.find((p) => p.id === 'hub')?.status, STATUS.OK, 'doctor sí vio el hub simulado');
  assert.deepEqual(signals, [], 'doctor no envía señales a ningún proceso');
  assert.equal(JSON.stringify(procs), before, 'doctor no cambia la tabla de procesos');
});

test('DR-04c el código de doctor no contiene escrituras, borrados ni terminaciones de procesos', () => {
  const writers = /writeFileSync|writeAtomic|appendFile|rmSync|unlinkSync|rmdirSync|mkdirSync|renameSync|process\.kill|taskkill|signalProcessTree|killTracked|\bspawn\(/;
  for (const file of fs.readdirSync(doctorDir)) {
    const src = fs.readFileSync(path.join(doctorDir, file), 'utf8');
    assert.doesNotMatch(src, writers, `${file} no debe escribir, borrar ni matar procesos`);
  }
});
