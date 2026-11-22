// Carga y validación de los casos de evals (un JSON por línea en evals/cases/*.jsonl).
//
// Formato de cada caso:
//   suite "exact":  { id, suite, tipo, smoke?, entrada, esperado }      esperado = campos exactos
//   suite "rubric": { id, suite, tipo, smoke?, entrada, rubrica }       rubrica = { minimo?, criterios[] }

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SUITES = ['exact', 'rubric'];

/** Valida un caso. Devuelve el propio caso o lanza un error con la ubicación. */
export function validarCaso(caso, origen = '?') {
  const donde = `${origen} (${caso?.id ?? 'sin id'})`;
  if (!caso || typeof caso !== 'object') throw new Error(`${origen}: caso no es un objeto`);
  if (typeof caso.id !== 'string' || !caso.id) throw new Error(`${donde}: falta id`);
  if (!SUITES.includes(caso.suite)) throw new Error(`${donde}: suite debe ser exact o rubric`);
  if (typeof caso.tipo !== 'string' || !caso.tipo) throw new Error(`${donde}: falta tipo`);
  if (!caso.entrada || typeof caso.entrada !== 'object') throw new Error(`${donde}: falta entrada`);
  if (caso.suite === 'exact' && (!caso.esperado || typeof caso.esperado !== 'object')) {
    throw new Error(`${donde}: un caso exact necesita esperado`);
  }
  if (caso.suite === 'rubric' && !Array.isArray(caso.rubrica?.criterios)) {
    throw new Error(`${donde}: un caso rubric necesita rubrica.criterios`);
  }
  return caso;
}

/** Lee todos los .jsonl de un directorio. Ids duplicados son un error. */
export function leerTodosLosCasos(dir) {
  if (!existsSync(dir)) throw new Error(`no existe el directorio de casos: ${dir}`);
  const casos = [];
  const vistos = new Set();
  for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const lineas = readFileSync(join(dir, archivo), 'utf8').split(/\r?\n/);
    lineas.forEach((linea, i) => {
      if (!linea.trim()) return;
      let caso;
      try {
        caso = JSON.parse(linea);
      } catch {
        throw new Error(`${archivo}:${i + 1}: JSON no válido`);
      }
      validarCaso(caso, `${archivo}:${i + 1}`);
      if (vistos.has(caso.id)) throw new Error(`${archivo}:${i + 1}: id duplicado ${caso.id}`);
      vistos.add(caso.id);
      casos.push(caso);
    });
  }
  return casos;
}

/** Filtra por suite y, con smoke, por el subconjunto marcado con "smoke": true. */
export function cargarCasos(dir, { suite = 'all', smoke = false } = {}) {
  return leerTodosLosCasos(dir).filter(
    (c) => (suite === 'all' || c.suite === suite) && (!smoke || c.smoke === true),
  );
}
