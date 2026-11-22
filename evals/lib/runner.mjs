// Motor de evals: aplica un modelo a cada caso, califica y calcula precisión por suite frente al piso.
// No escribe nada en disco; eso lo hace evals/run.mjs.

import { cargarCasos, SUITES } from './casos.mjs';
import { exact } from '../graders/exact.mjs';
import { aprueba, judge, juezOpenCode } from '../graders/rubric.mjs';

const SIN_DATO = 'sin dato';

/** Suma el uso reportado por el proveedor. Si algún caso no trae uso, el total es "sin dato". */
function acumularCoste(acc, uso) {
  if (acc.sinDato) return acc;
  if (!uso || typeof uso.tokens_entrada !== 'number') return { sinDato: true };
  return {
    sinDato: false,
    tokens_entrada: (acc.tokens_entrada ?? 0) + uso.tokens_entrada,
    tokens_salida: (acc.tokens_salida ?? 0) + (uso.tokens_salida ?? 0),
    usd: (acc.usd ?? 0) + (typeof uso.usd === 'number' ? uso.usd : 0),
  };
}

function costeFinal(acc) {
  if (acc.sinDato || acc.tokens_entrada === undefined) {
    return { tokens_entrada: SIN_DATO, tokens_salida: SIN_DATO, usd: SIN_DATO };
  }
  return { tokens_entrada: acc.tokens_entrada, tokens_salida: acc.tokens_salida, usd: acc.usd };
}

/**
 * @param {object} opciones
 * @param {string} opciones.casosDir   directorio con los .jsonl
 * @param {'exact'|'rubric'|'all'} [opciones.suite='all']
 * @param {boolean} [opciones.smoke=false]  solo casos con smoke: true
 * @param {number} [opciones.piso=0.9]      precisión mínima por suite (0..1 o mayor para forzar fallo)
 * @param {object} opciones.modelo           adaptador de getModelo()
 * @param {'simulado'|'opencode'} [opciones.juez='simulado']
 */
export async function ejecutar({ casosDir, suite = 'all', smoke = false, piso = 0.9, modelo, juez = 'simulado' }) {
  const todos = cargarCasos(casosDir, { suite, smoke });
  if (todos.length === 0) throw new Error('no hay casos que correr con esos filtros');
  const calificarTexto = juez === 'opencode' ? juezOpenCode : judge;

  const suites = {};
  const coste = { sinDato: false };
  for (const nombre of SUITES) {
    const lista = todos.filter((c) => c.suite === nombre);
    if (lista.length === 0) continue;
    const casos = [];
    for (const caso of lista) {
      try {
        const { salida, uso } = await modelo.responder(caso);
        Object.assign(coste, acumularCoste(coste, uso));
        if (caso.suite === 'exact') {
          const g = exact(salida, caso.esperado);
          casos.push({ id: caso.id, ok: g.ok, ...(g.ok ? {} : { diferencias: g.diferencias }) });
        } else {
          const r = await calificarTexto(salida, caso.rubrica);
          casos.push({ id: caso.id, ok: aprueba(r, caso.rubrica), score: Number(r.score.toFixed(2)) });
        }
      } catch (error) {
        casos.push({ id: caso.id, ok: false, error: error.message });
      }
    }
    const ok = casos.filter((c) => c.ok).length;
    const precision = Number((ok / casos.length).toFixed(4));
    suites[nombre] = { total: casos.length, ok, precision, bajo_piso: precision < piso, casos };
  }

  const bajo = Object.values(suites).some((s) => s.bajo_piso);
  return {
    fecha: new Date().toISOString(),
    modelo: modelo.nombre,
    juez,
    piso,
    smoke,
    suites,
    coste: costeFinal(coste),
    resultado: bajo ? 'bajo_piso' : 'ok',
  };
}
