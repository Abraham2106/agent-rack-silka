// Pruebas de evals: deterministas, sin red, sin depender de tiempos ni de procesos del sistema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exact } from '../evals/graders/exact.mjs';
import { juezSimulado, judge, aprueba, parsearVeredictoOpenCode } from '../evals/graders/rubric.mjs';
import { cargarCasos, leerTodosLosCasos, validarCaso } from '../evals/lib/casos.mjs';
import { ejecutar } from '../evals/lib/runner.mjs';
import { getModelo } from '../evals/modelos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASOS = join(RAIZ, 'evals', 'cases');
const RUN = join(RAIZ, 'evals', 'run.mjs');
const BATCH = join(RAIZ, 'evals', 'batch.mjs');

function correr(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
    windowsHide: true,
  });
}

function temporal() {
  return mkdtempSync(join(tmpdir(), 'silka-evals-'));
}

test('exact: compara solo los campos declarados y sin importar el orden de las claves', () => {
  const ok = exact({ level: 'alto', requiresHuman: true, reasons: ['a', 'b'], extra: 1 }, {
    level: 'alto',
    reasons: ['a', 'b'],
  });
  assert.equal(ok.ok, true);

  const mal = exact({ level: 'bajo', reasons: ['b', 'a'] }, { level: 'alto', reasons: ['a', 'b'] });
  assert.equal(mal.ok, false);
  assert.deepEqual(
    mal.diferencias.map((d) => d.campo),
    ['level', 'reasons'],
  );
});

test('exact: un campo ausente en la salida no coincide con uno esperado', () => {
  const r = exact({}, { requiresHuman: false });
  assert.equal(r.ok, false);
  assert.equal(r.diferencias[0].obtenido, undefined);
});

test('rubric simulado: puntúa por criterios con palabras fijas y aprueba según el mínimo', () => {
  const rubrica = {
    minimo: 0.66,
    criterios: [
      { id: 'a', descripcion: 'x', palabras: ['alfa'] },
      { id: 'b', descripcion: 'y', palabras: ['beta', 'gamma'] },
      { id: 'c', descripcion: 'z', palabras: ['delta'] },
    ],
  };
  const r = juezSimulado('Texto con ALFA y gamma', rubrica);
  assert.deepEqual(r.criterios.map((c) => c.ok), [true, true, false]);
  assert.equal(Number(r.score.toFixed(3)), 0.667);
  assert.equal(aprueba(r, rubrica), true);
  assert.equal(aprueba(r, { ...rubrica, minimo: 0.9 }), false);
});

test('rubric: la interfaz judge(output, rubric) es determinista y no usa red', async () => {
  const rubrica = { criterios: [{ id: 'a', descripcion: 'x', palabras: ['hola'] }] };
  const r1 = await judge('hola mundo', rubrica);
  const r2 = await judge('hola mundo', rubrica);
  assert.deepEqual(r1, r2);
  assert.equal(r1.score, 1);
});

test('rubric: el veredicto de OpenCode se interpreta desde eventos JSON; sin veredicto falla', () => {
  const rubrica = { criterios: [{ id: 'a', descripcion: 'x' }, { id: 'b', descripcion: 'y' }] };
  const evento = JSON.stringify({ type: 'text', part: { text: '{"criterios":[{"id":"a","ok":true},{"id":"b","ok":false}]}' } });
  const r = parsearVeredictoOpenCode(`${evento}\n`, rubrica);
  assert.equal(r.score, 0.5);
  assert.throws(() => parsearVeredictoOpenCode('{"type":"text"}\n', rubrica), /no devolvió un veredicto/);
});

test('casos: las dos suites existen, los ids son únicos y el subconjunto smoke es propio y no vacío', () => {
  const todos = leerTodosLosCasos(CASOS);
  const ids = new Set(todos.map((c) => c.id));
  assert.equal(ids.size, todos.length);
  for (const suite of ['exact', 'rubric']) {
    const del = todos.filter((c) => c.suite === suite);
    const smoke = cargarCasos(CASOS, { suite, smoke: true });
    assert.ok(del.length >= 5 && del.length <= 10, `${suite} tiene ${del.length} casos`);
    assert.ok(smoke.length > 0 && smoke.length < del.length, `${suite} smoke=${smoke.length}`);
  }
});

test('casos: validarCaso rechaza casos mal formados', () => {
  assert.throws(() => validarCaso({ id: 'x', suite: 'exact', tipo: 't', entrada: {} }), /necesita esperado/);
  assert.throws(() => validarCaso({ id: 'x', suite: 'rubric', tipo: 't', entrada: {} }), /rubrica.criterios/);
  assert.throws(() => validarCaso({ id: 'x', suite: 'otra', tipo: 't', entrada: {} }), /suite debe ser/);
});

test('runner: con el modelo fake la suite completa queda sobre el piso por defecto', async () => {
  const r = await ejecutar({ casosDir: CASOS, piso: 0.9, modelo: getModelo('fake') });
  assert.equal(r.resultado, 'ok');
  assert.equal(r.suites.exact.precision, 1);
  assert.equal(r.suites.rubric.precision, 1);
  assert.equal(r.coste.usd, 'sin dato');
});

test('runner: con un piso imposible marca bajo_piso', async () => {
  const r = await ejecutar({ casosDir: CASOS, piso: 1.01, modelo: getModelo('fake') });
  assert.equal(r.resultado, 'bajo_piso');
  assert.equal(r.suites.exact.bajo_piso, true);
});

test('runner: --smoke solo corre el subconjunto marcado', async () => {
  const r = await ejecutar({ casosDir: CASOS, smoke: true, piso: 0, modelo: getModelo('fake') });
  assert.equal(r.suites.exact.total, cargarCasos(CASOS, { suite: 'exact', smoke: true }).length);
  assert.equal(r.suites.rubric.total, cargarCasos(CASOS, { suite: 'rubric', smoke: true }).length);
});

test('CLI: sale con 1 bajo el piso y con 0 sobre él, y guarda el informe en la carpeta indicada', () => {
  const salida = temporal();
  try {
    const bajo = correr(RUN, ['--piso', '1.01', '--salida', salida]);
    assert.equal(bajo.status, 1, bajo.stdout + bajo.stderr);
    assert.match(bajo.stdout, /BAJO PISO/);

    const sobre = correr(RUN, ['--piso', '0.5', '--salida', salida]);
    assert.equal(sobre.status, 0, sobre.stdout + sobre.stderr);
    assert.match(sobre.stdout, /resultado: OK \(salida 0\)/);
    assert.match(sobre.stdout, /informe: /);
  } finally {
    rmSync(salida, { recursive: true, force: true });
  }
});

test('CLI: --smoke --json imprime un informe JSON solo con el subconjunto', () => {
  const salida = temporal();
  try {
    const r = correr(RUN, ['--smoke', '--json', '--salida', salida]);
    assert.equal(r.status, 0, r.stderr);
    const informe = JSON.parse(r.stdout);
    assert.equal(informe.smoke, true);
    assert.equal(informe.suites.exact.total, cargarCasos(CASOS, { suite: 'exact', smoke: true }).length);
  } finally {
    rmSync(salida, { recursive: true, force: true });
  }
});

test('CLI: una opción desconocida o un modelo inexistente salen con 2', () => {
  assert.equal(correr(RUN, ['--opcion-rara']).status, 2);
  const salida = temporal();
  try {
    assert.equal(correr(RUN, ['--modelo', 'no-existe', '--salida', salida]).status, 2);
  } finally {
    rmSync(salida, { recursive: true, force: true });
  }
});

test('batch --dry-run muestra una petición por caso y no hace red', () => {
  // Un preload que hace fallar cualquier fetch: si el dry-run llamara a la red, el código no sería 0.
  const sinRed = `data:text/javascript,globalThis.fetch=()=>{throw new Error("red bloqueada en test")}`;
  const r = spawnSync(process.execPath, ['--import', sinRed, BATCH, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: 'clave-de-prueba' },
    timeout: 60_000,
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lote = JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1));
  assert.equal(lote.requests.length, leerTodosLosCasos(CASOS).length);
  assert.equal(lote.requests[0].params.model, 'claude-haiku-5-5');
});

test('batch sin ANTHROPIC_API_KEY sale con 0 y un mensaje claro', () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, [BATCH], { encoding: 'utf8', env, timeout: 60_000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sin ANTHROPIC_API_KEY/);
});
