#!/usr/bin/env node
// CLI de evals de Silka. Uso:
//   node evals/run.mjs [--suite exact|rubric|all] [--smoke] [--piso 0.9] [--modelo fake|opencode/hy4-flash-free]
//                      [--juez simulado|opencode] [--json] [--casos <dir>] [--salida <dir>]
//
// Códigos de salida: 0 = todas las suites sobre el piso; 1 = alguna suite bajo el piso (puerta de merge);
// 2 = error de uso o de configuración (opción desconocida, caso mal formado, modelo inexistente).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutar } from './lib/runner.mjs';
import { getModelo } from './modelos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const AYUDA = `Uso: node evals/run.mjs [opciones]
  --suite exact|rubric|all   suite a correr (por defecto all)
  --smoke                    solo los casos con smoke: true
  --piso <n>                 precisión mínima por suite, 0..1 (por defecto 0.9)
  --modelo <id>              fake (por defecto) o opencode/hy4-flash-free
  --juez simulado|opencode   juez de texto libre (por defecto simulado)
  --json                     imprime el informe completo en JSON
  --casos <dir>              directorio de casos (por defecto evals/cases)
  --salida <dir>             dónde guardar el informe (por defecto evals/reports)`;

function leerArgs(argv) {
  const o = { suite: 'all', smoke: false, piso: 0.9, modelo: 'fake', juez: 'simulado', json: false, casos: join(AQUI, 'cases'), salida: join(AQUI, 'reports') };
  const valor = (i, nombre) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${nombre} necesita un valor`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--suite': o.suite = valor(i++, a); break;
      case '--smoke': o.smoke = true; break;
      case '--piso': o.piso = Number(valor(i++, a)); break;
      case '--modelo': o.modelo = valor(i++, a); break;
      case '--juez': o.juez = valor(i++, a); break;
      case '--json': o.json = true; break;
      case '--casos': o.casos = resolve(valor(i++, a)); break;
      case '--salida': o.salida = resolve(valor(i++, a)); break;
      case '--help': case '-h': o.ayuda = true; break;
      default: throw new Error(`opción desconocida: ${a}`);
    }
  }
  if (!['exact', 'rubric', 'all'].includes(o.suite)) throw new Error('--suite debe ser exact, rubric o all');
  if (!['simulado', 'opencode'].includes(o.juez)) throw new Error('--juez debe ser simulado u opencode');
  if (!Number.isFinite(o.piso) || o.piso < 0) throw new Error('--piso debe ser un número >= 0');
  return o;
}

/** Nombre de archivo con fecha y hora, sin caracteres no válidos en Windows. */
function nombreInforme(fecha) {
  return `${fecha.slice(0, 19).replace(/:/g, '-').replace('T', '_')}.json`;
}

function resumen(informe) {
  const lineas = [`evals · modelo ${informe.modelo} · juez ${informe.juez} · piso ${informe.piso.toFixed(2)}${informe.smoke ? ' · smoke' : ''}`];
  for (const [nombre, s] of Object.entries(informe.suites)) {
    const pct = (s.precision * 100).toFixed(1).padStart(5);
    lineas.push(`${nombre.padEnd(7)} ${s.ok}/${s.total}  ${pct}%  ${s.bajo_piso ? 'BAJO PISO' : 'OK'}`);
  }
  const fallos = Object.entries(informe.suites).flatMap(([n, s]) => s.casos.filter((c) => !c.ok).map((c) => `${n}/${c.id}`));
  if (fallos.length) lineas.push(`fallos: ${fallos.join(', ')}`);
  lineas.push(`coste: tokens_entrada=${informe.coste.tokens_entrada} tokens_salida=${informe.coste.tokens_salida} usd=${informe.coste.usd}`);
  return lineas.join('\n');
}

async function main(argv) {
  let o;
  try {
    o = leerArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${AYUDA}\n`);
    return 2;
  }
  if (o.ayuda) {
    process.stdout.write(`${AYUDA}\n`);
    return 0;
  }
  let informe;
  try {
    informe = await ejecutar({
      casosDir: o.casos,
      suite: o.suite,
      smoke: o.smoke,
      piso: o.piso,
      modelo: getModelo(o.modelo),
      juez: o.juez,
    });
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 2;
  }
  mkdirSync(o.salida, { recursive: true });
  const ruta = join(o.salida, nombreInforme(informe.fecha));
  writeFileSync(ruta, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');

  const codigo = informe.resultado === 'ok' ? 0 : 1;
  if (o.json) {
    process.stdout.write(`${JSON.stringify(informe, null, 2)}\n`);
  } else {
    process.stdout.write(`${resumen(informe)}\ninforme: ${ruta}\n`);
    process.stdout.write(`resultado: ${informe.resultado === 'ok' ? 'OK' : 'BAJO PISO'} (salida ${codigo})\n`);
  }
  return codigo;
}

main(process.argv.slice(2)).then((codigo) => {
  process.exitCode = codigo;
});
