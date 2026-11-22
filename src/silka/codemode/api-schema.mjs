import { silkaError } from './errors.mjs';
import { MAX_IPC_MESSAGE_BYTES } from './limits.mjs';

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw silkaError('E_POLICY', `Argumento '${name}' debe ser un string no vacío.`);
  }
  return value.trim();
}

function assertOptionalString(value, name) {
  if (value == null) return undefined;
  return assertString(value, name);
}

function assertReviewOpts(value) {
  if (value == null || typeof value !== 'object') {
    throw silkaError('E_POLICY', 'Se requiere { version } con el número de versión visto.');
  }
  const version = Number(value.version);
  if (!Number.isFinite(version) || version < 1) {
    throw silkaError('E_POLICY', 'Se requiere { version } con el número de versión visto.');
  }
  return { ...value, version };
}

export function validateIpcPayload(payload) {
  const raw = JSON.stringify(payload ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_IPC_MESSAGE_BYTES) {
    throw silkaError('E_LIMIT', 'Mensaje IPC demasiado grande.', { limit: 'ipcMessageBytes', max: MAX_IPC_MESSAGE_BYTES });
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.path)) {
    throw silkaError('E_POLICY', 'Llamada IPC mal formada.');
  }
  return payload;
}

export function validateApiArgs(path, args) {
  const method = path.join('.');
  const list = Array.isArray(args) ? args : [];
  switch (method) {
    case 'launch': {
      if (!list[0]) throw silkaError('E_POLICY', 'launch requiere un plan o tarea.');
      return list;
    }
    case 'plan.fromFile':
      return [assertString(list[0], 'path')];
    case 'plan.fromList': {
      if (!Array.isArray(list[0]) || !list[0].length) {
        throw silkaError('E_POLICY', 'plan.fromList requiere un array de tareas.');
      }
      return list;
    }
    case 'wait':
      return [assertString(list[0], 'sessionId'), list[1] || {}];
    case 'waitAll': {
      if (!Array.isArray(list[0]) || !list[0].length) throw silkaError('E_POLICY', 'waitAll requiere un array de ids.');
      return list;
    }
    case 'status':
    case 'card':
    case 'cancel':
      return [assertString(list[0], 'sessionId')];
    case 'get':
      return [assertString(list[0], 'ref')];
    case 'send':
      return [assertString(list[0], 'sessionId'), assertString(list[1], 'text'), list[2] || {}];
    case 'state.summary':
      return list;
    case 'state.changes':
      return [assertOptionalString(list[0], 'since')];
    case 'state.decide':
      return [assertString(list[0], 'text')];
    case 'agents.list':
      return list;
    case 'agents.models':
      return [assertString(list[0], 'agent')];
    case 'agents.stats':
      return [assertString(list[0], 'agent'), assertString(list[1], 'model')];
    case 'review.inbox':
      return list;
    case 'review.approve':
      return [assertString(list[0], 'id'), assertReviewOpts(list[1])];
    case 'review.reject':
      return [assertString(list[0], 'id'), assertString(list[1], 'note'), assertReviewOpts(list[2])];
    case 'review.discard':
      return [assertString(list[0], 'id'), assertReviewOpts(list[1])];
    case 'merge.queue':
      return list;
    case 'merge.status':
      return [assertString(list[0], 'id')];
    case 'plan.status':
      return [assertString(list[0], 'planId')];
    default:
      return list;
  }
}