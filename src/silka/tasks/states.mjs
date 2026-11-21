export const STATES = {
  PLANIFICADA: 'planificada',
  ESPERANDO_DEPS: 'esperando_dependencias',
  TRABAJANDO: 'trabajando',
  VERIFICANDO: 'verificando',
  LISTA: 'lista_para_revision',
  REPARANDO: 'reparando',
  APROBADA: 'aprobada',
  COLA_MEZCLA: 'en_cola_mezcla',
  MEZCLADA: 'mezclada',
  RECHAZADA: 'rechazada',
  DESCARTADA: 'descartada',
  BLOQUEADA: 'bloqueada',
};

/** Transiciones válidas: de → Set(hacia). Solo el hub las ejecuta (I-6). */
export const TRANSITIONS = {
  [STATES.PLANIFICADA]: new Set([STATES.ESPERANDO_DEPS, STATES.TRABAJANDO, STATES.BLOQUEADA, STATES.DESCARTADA]),
  [STATES.ESPERANDO_DEPS]: new Set([STATES.TRABAJANDO, STATES.BLOQUEADA, STATES.DESCARTADA]),
  [STATES.TRABAJANDO]: new Set([STATES.VERIFICANDO, STATES.REPARANDO, STATES.DESCARTADA]),
  [STATES.VERIFICANDO]: new Set([STATES.LISTA, STATES.REPARANDO]),
  [STATES.REPARANDO]: new Set([STATES.TRABAJANDO, STATES.VERIFICANDO, STATES.DESCARTADA]),
  [STATES.LISTA]: new Set([STATES.APROBADA, STATES.RECHAZADA, STATES.DESCARTADA]),
  [STATES.APROBADA]: new Set([STATES.COLA_MEZCLA]),
  [STATES.COLA_MEZCLA]: new Set([STATES.MEZCLADA, STATES.REPARANDO]),
  [STATES.RECHAZADA]: new Set([STATES.TRABAJANDO]),
  [STATES.MEZCLADA]: new Set(),
  [STATES.DESCARTADA]: new Set(),
  [STATES.BLOQUEADA]: new Set([STATES.DESCARTADA]),
};

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function activeWorkStates() {
  return new Set([
    STATES.TRABAJANDO,
    STATES.VERIFICANDO,
    STATES.REPARANDO,
  ]);
}