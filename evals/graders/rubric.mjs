// Calificador de texto libre con rúbrica. Interfaz: judge(output, rubric) -> { score, criterios }.
//
// - judge()          juez simulado y determinista: cada criterio se cumple si la salida contiene
//                    alguna de sus "palabras" (sin distinguir mayúsculas). Corre sin red ni coste.
// - juezOpenCode()   juez real opcional: pide a un LLM (OpenCode, modelo gratuito) que marque cada
//                    criterio. Solo se usa con --juez opencode; si OpenCode no está, falla con claro error.
//
// Rúbrica: { minimo?: number (0..1, por defecto 1), criterios: [{ id, descripcion, palabras? }] }

import { ejecutarOpenCode } from '../lib/opencode.mjs';

export const MODELO_JUEZ_GRATIS = 'opencode/hy4-flash-free';

/** Juez simulado: determinista, para pruebas y para el modo por defecto. */
export function juezSimulado(salida, rubrica) {
  const texto = String(salida ?? '').toLowerCase();
  const criterios = (rubrica?.criterios ?? []).map((c) => ({
    id: c.id,
    ok: (c.palabras ?? []).some((p) => texto.includes(String(p).toLowerCase())),
  }));
  const aciertos = criterios.filter((c) => c.ok).length;
  return {
    juez: 'simulado',
    score: criterios.length ? aciertos / criterios.length : 0,
    criterios,
  };
}

/** Interfaz pública que usa el runner. Por defecto, el juez simulado. */
export async function judge(output, rubric) {
  return juezSimulado(output, rubric);
}

/** Decide si un resultado de juez alcanza el mínimo de la rúbrica. */
export function aprueba(resultado, rubrica) {
  return resultado.score >= (rubrica?.minimo ?? 1);
}

/** Texto de la petición al juez real. Sin datos del caso más allá de la rúbrica y la salida. */
export function promptJuez(salida, rubrica) {
  const lista = (rubrica?.criterios ?? []).map((c) => `- ${c.id}: ${c.descripcion}`).join('\n');
  return [
    'Eres un juez estricto. Evalúa la respuesta según cada criterio de la rúbrica.',
    'Criterios:',
    lista,
    'Respuesta a evaluar (entre <<< y >>>):',
    `<<<${String(salida ?? '')}>>>`,
    'Responde solo con JSON de esta forma: {"criterios":[{"id":"<id>","ok":true|false}]}',
  ].join('\n');
}

/** Recoge todos los textos de un objeto JSON anidado (la salida de OpenCode llega como eventos). */
function textos(valor, acumulado = []) {
  if (typeof valor === 'string') acumulado.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textos(v, acumulado));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach((v) => textos(v, acumulado));
  return acumulado;
}

/**
 * Interpreta la salida de `opencode run --format json`: busca el JSON de criterios entre los textos.
 * Lanza error si no lo encuentra; nunca inventa un veredicto.
 */
export function parsearVeredictoOpenCode(stdout, rubrica) {
  const fragmentos = [];
  for (const linea of String(stdout ?? '').split(/\r?\n/)) {
    if (!linea.trim()) continue;
    try {
      textos(JSON.parse(linea), fragmentos);
    } catch {
      fragmentos.push(linea);
    }
  }
  const buscar = /\{[^{}]*"criterios"[\s\S]*?\]\s*\}/;
  const hallado = fragmentos.map((f) => f.match(buscar)).find(Boolean);
  if (!hallado) throw new Error('el juez no devolvió un veredicto con "criterios"');
  const veredicto = JSON.parse(hallado[0]);
  const porId = new Map(veredicto.criterios.map((c) => [c.id, c.ok === true]));
  const criterios = (rubrica?.criterios ?? []).map((c) => ({ id: c.id, ok: porId.get(c.id) === true }));
  const aciertos = criterios.filter((c) => c.ok).length;
  return { juez: MODELO_JUEZ_GRATIS, score: criterios.length ? aciertos / criterios.length : 0, criterios };
}

/**
 * Juez real opcional con OpenCode. No es obligatorio: si `opencode` no está en el PATH,
 * lanza un error claro y el runner marca el caso como error (no como acierto).
 */
export async function juezOpenCode(salida, rubrica) {
  const r = await ejecutarOpenCode(promptJuez(salida, rubrica), { modelo: MODELO_JUEZ_GRATIS });
  return parsearVeredictoOpenCode(r.stdout, rubrica);
}
