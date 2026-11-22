#!/usr/bin/env node
// Envío de la suite completa por la Message Batches API de Anthropic (POST /v1/messages/batches).
// Pensado para correr cuando nadie espera el resultado: cuesta menos que las llamadas síncronas.
//
// Uso:
//   node evals/batch.mjs --dry-run            muestra el JSON de la petición; no hace red
//   node evals/batch.mjs                      envía el lote si hay ANTHROPIC_API_KEY; si no, sale con 0 y un aviso
//   opciones: --modelo <id> (por defecto claude-haiku-5-5), --max-tokens <n> (1024), --casos <dir>
//
// Esqueleto: solo crea el lote. Consultar el estado y descargar resultados queda como siguiente paso
// (GET /v1/messages/batches/{id} y results_url). Sin clave no se pide nada ni se llama a la API.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarCasos } from './lib/casos.mjs';
import { promptDe } from './modelos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_LOTES = 'https://api.anthropic.com/v1/messages/batches';
const VERSION_API = '2023-06-01';

function leerArgs(argv) {
  const o = { dryRun: false, modelo: 'claude-haiku-5-5', maxTokens: 1024, casos: join(AQUI, 'cases') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--modelo') o.modelo = argv[++i];
    else if (a === '--max-tokens') o.maxTokens = Number(argv[++i]);
    else if (a === '--casos') o.casos = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') o.ayuda = true;
    else throw new Error(`opción desconocida: ${a}`);
  }
  if (!o.modelo) throw new Error('--modelo necesita un valor');
  if (!Number.isInteger(o.maxTokens) || o.maxTokens < 1) throw new Error('--max-tokens debe ser un entero positivo');
  return o;
}

/** Petición del lote: un elemento por caso de la suite completa. custom_id = id del caso. */
export function construirLote(casos, { modelo, maxTokens }) {
  return {
    requests: casos.map((caso) => ({
      custom_id: caso.id,
      params: {
        model: modelo,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: promptDe(caso) }],
      },
    })),
  };
}

async function enviar(lote, clave) {
  const r = await fetch(URL_LOTES, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': clave,
      'anthropic-version': VERSION_API,
    },
    body: JSON.stringify(lote),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`la API respondió ${r.status}: ${cuerpo?.error?.message ?? 'sin detalle'}`);
  return cuerpo;
}

async function main(argv) {
  let o;
  try {
    o = leerArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (o.ayuda) {
    process.stdout.write('Uso: node evals/batch.mjs [--dry-run] [--modelo id] [--max-tokens n] [--casos dir]\n');
    return 0;
  }
  let casos;
  try {
    casos = cargarCasos(o.casos);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 2;
  }
  const lote = construirLote(casos, o);

  if (o.dryRun) {
    process.stdout.write(`${JSON.stringify(lote, null, 2)}\n`);
    process.stdout.write(`dry-run: ${casos.length} peticiones; no se envió nada\n`);
    return 0;
  }
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) {
    process.stdout.write('sin ANTHROPIC_API_KEY: no se envía el lote. Usa --dry-run para ver la petición.\n');
    return 0;
  }
  try {
    const creado = await enviar(lote, clave);
    process.stdout.write(`lote creado: ${creado.id} (${creado.processing_status ?? 'desconocido'}), ${casos.length} peticiones\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}

main(process.argv.slice(2)).then((codigo) => {
  process.exitCode = codigo;
});
