// Calificador de campos exactos. Compara solo los campos que el caso declara en "esperado";
// el resto de la salida se ignora. Sin red ni modelo: es código puro.

/** Serializa con claves ordenadas para comparar objetos sin importar el orden de las claves. */
function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, canonico(valor[k])]));
  }
  return valor;
}

export function iguales(a, b) {
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
}

/**
 * @param {object} obtenido  salida del modelo (o de la función de referencia)
 * @param {object} esperado  campos que deben coincidir exactamente
 * @returns {{ ok: boolean, diferencias: Array<{campo: string, esperado: unknown, obtenido: unknown}> }}
 */
export function exact(obtenido, esperado) {
  const diferencias = [];
  for (const campo of Object.keys(esperado ?? {})) {
    const valor = obtenido?.[campo];
    if (!iguales(valor, esperado[campo])) {
      diferencias.push({ campo, esperado: esperado[campo], obtenido: valor });
    }
  }
  return { ok: diferencias.length === 0, diferencias };
}
