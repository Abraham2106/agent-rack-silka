// Adaptadores de modelo para las evals.
//
// - fake (por defecto): determinista, sin red ni coste. Para los casos de tipo "riesgo" responde con
//   la función real de src/silka/tasks/risk.mjs, así que la suite funciona como prueba de regresión
//   de esas reglas. Para texto libre devuelve una plantilla fija. NO mide la calidad de un LLM.
// - opencode/hy4-flash-free: adaptador real opcional. Usa OpenCode con el modelo gratuito; si no está
//   instalado, falla con error claro. Nunca es obligatorio.

import { spawnSync } from 'node:child_process';
import { assessRisk } from '../src/silka/tasks/risk.mjs';
import { MODELO_JUEZ_GRATIS } from './graders/rubric.mjs';

/** Texto de la petición que recibe un modelo real para un caso. */
export function promptDe(caso) {
  if (caso.suite === 'exact') {
    return [
      'Aplica las reglas de clasificación de riesgo de Silka a la entrada y responde solo con JSON',
      'con los campos "level" (bajo|medio|alto), "requiresHuman" (boolean) y "reasons" (array de strings).',
      `Entrada: ${JSON.stringify(caso.entrada)}`,
    ].join('\n');
  }
  return [
    'Resume para un revisor humano, en español, los cambios descritos. Incluye los archivos, el motivo',
    'y cómo se verificó.',
    `Entrada: ${JSON.stringify(caso.entrada)}`,
  ].join('\n');
}

const fake = {
  nombre: 'fake',
  coste: 'sin dato',
  async responder(caso) {
    if (caso.suite === 'exact') {
      if (caso.tipo !== 'riesgo') {
        throw new Error(`tipo exacto no soportado por el modelo fake: ${caso.tipo}`);
      }
      const { level, requiresHuman, reasons } = assessRisk(caso.entrada);
      return { salida: { level, requiresHuman, reasons }, uso: null };
    }
    const e = caso.entrada ?? {};
    const archivos = (e.archivos ?? []).join(', ');
    const salida = `Cambios en ${archivos}. Motivo: ${e.motivo ?? 'sin dato'}. Verificación: ${e.verify ?? 'sin dato'}.`;
    return { salida, uso: null };
  },
};

const opencode = {
  nombre: MODELO_JUEZ_GRATIS,
  coste: 'gratis (modelo de OpenCode)',
  async responder(caso) {
    const r = spawnSync('opencode', ['run', '--format', 'json', '--model', MODELO_JUEZ_GRATIS, promptDe(caso)], {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    });
    if (r.error?.code === 'ENOENT') throw new Error('opencode no está en el PATH; usa --modelo fake');
    if (r.error) throw new Error(`opencode falló: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`opencode salió con código ${r.status}`);
    // La salida real de OpenCode no se parsea aquí con garantías: el texto completo se califica tal cual.
    // Los campos exactos solo se comparan si la respuesta es JSON válido.
    if (caso.suite === 'exact') {
      const texto = String(r.stdout ?? '').trim();
      const inicio = texto.indexOf('{');
      const fin = texto.lastIndexOf('}');
      if (inicio < 0 || fin < inicio) throw new Error('la respuesta no contiene JSON');
      return { salida: JSON.parse(texto.slice(inicio, fin + 1)), uso: null };
    }
    return { salida: r.stdout, uso: null };
  },
};

export const MODELOS = { fake, [MODELO_JUEZ_GRATIS]: opencode };

/** Devuelve el adaptador del id pedido. Lanza error si el id no existe. */
export function getModelo(id = 'fake') {
  const m = MODELOS[id];
  if (!m) throw new Error(`modelo desconocido: ${id}. Opciones: ${Object.keys(MODELOS).join(', ')}`);
  return m;
}
