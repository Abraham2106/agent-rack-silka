import { silkaError } from '../codemode/errors.mjs';

const REQUIRED = ['title', 'scope', 'deliver', 'verify'];

export function normalizeTaskInput(raw, { id } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw silkaError('E_TASK_INVALID', 'Cada tarea debe ser un objeto.');
  }
  const missing = REQUIRED.filter((key) => {
    const v = raw[key];
    return v == null || (typeof v === 'string' && !v.trim());
  });
  if (missing.length) {
    throw silkaError('E_TASK_INVALID', `Faltan campos obligatorios: ${missing.join(', ')}.`);
  }
  const verify = Array.isArray(raw.verify)
    ? raw.verify.map(String).filter(Boolean)
    : String(raw.verify).split(/\n|&&/).map((s) => s.trim()).filter(Boolean);
  if (!verify.length) {
    throw silkaError('E_TASK_INVALID', 'verify debe incluir al menos un comando.');
  }
  const scope = Array.isArray(raw.scope)
    ? raw.scope.map(String).filter(Boolean)
    : String(raw.scope).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const dependsOn = Array.isArray(raw.dependsOn)
    ? raw.dependsOn.map(String).filter(Boolean)
    : (raw.dependsOn ? [String(raw.dependsOn)] : []);
  const ports = Number(raw.ports);
  return {
    id: id || raw.id,
    title: String(raw.title).trim(),
    scope,
    deliver: String(raw.deliver).trim(),
    verify,
    agent: raw.agent ? String(raw.agent) : undefined,
    model: raw.model ? String(raw.model) : undefined,
    dependsOn,
    ports: Number.isInteger(ports) && ports > 0 ? ports : 0,
    prompt: raw.prompt ? String(raw.prompt) : undefined,
  };
}

export function validateTaskList(items) {
  if (!Array.isArray(items) || !items.length) {
    throw silkaError('E_TASK_INVALID', 'El plan debe ser una lista no vacía de tareas.');
  }
  return items.map((item) => normalizeTaskInput(item));
}