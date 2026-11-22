import { silkaError } from '../codemode/errors.mjs';
import { inferVerifyCommands } from './infer-verify.mjs';
import { DEFAULT_ROLE, DEFAULT_SIZE, ROLES, SIZES } from '../routing.mjs';

const REQUIRED = ['title', 'scope', 'deliver'];

function normalizeRole(raw) {
  if (raw == null || raw === '') return DEFAULT_ROLE;
  if (!ROLES.includes(String(raw))) {
    throw silkaError('E_TASK_INVALID', `role desconocido "${raw}" (usa ${ROLES.join(', ')}).`);
  }
  return String(raw);
}

function normalizeSize(raw) {
  if (raw == null || raw === '') return DEFAULT_SIZE;
  if (!SIZES.includes(String(raw))) {
    throw silkaError('E_TASK_INVALID', `size desconocido "${raw}" (usa ${SIZES.join(', ')}).`);
  }
  return String(raw);
}

function parseVerify(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(/\n|&&/).map((s) => s.trim()).filter(Boolean);
}

function parseAccept(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) {
    throw silkaError('E_TASK_INVALID', 'accept debe ser un array.');
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw silkaError('E_TASK_INVALID', 'Cada criterio accept debe ser un objeto.');
    }
    const keys = Object.keys(item);
    if (keys.length !== 1 || !['cmd', 'grep', 'file'].includes(keys[0])) {
      throw silkaError('E_TASK_INVALID', 'accept: usa { cmd }, { grep } o { file }.');
    }
    if (item.grep && (!item.grep.pattern || !item.grep.path)) {
      throw silkaError('E_TASK_INVALID', 'accept.grep requiere pattern y path.');
    }
    if (item.file && !item.file.path) {
      throw silkaError('E_TASK_INVALID', 'accept.file requiere path.');
    }
  }
  return raw;
}

export function normalizeTaskInput(raw, { id, repoRoot, strictVerify = false } = {}) {
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
  const allowNoVerify = Boolean(raw.allowNoVerify);
  let verify = parseVerify(raw.verify);
  let verifySource = verify.length ? 'declarado' : 'pendiente';
  if (!verify.length && !allowNoVerify && repoRoot) {
    const inferred = inferVerifyCommands(repoRoot);
    if (inferred?.length) {
      verify = inferred;
      verifySource = 'inferido';
    } else if (strictVerify) {
      throw silkaError('E_TASK_INVALID', 'verify obligatorio o inferible desde el repo.');
    }
  }
  if (!verify.length && allowNoVerify) verifySource = 'ninguno';

  const scope = Array.isArray(raw.scope)
    ? raw.scope.map(String).filter(Boolean)
    : String(raw.scope).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const dependsOn = Array.isArray(raw.dependsOn)
    ? raw.dependsOn.map(String).filter(Boolean)
    : (raw.dependsOn ? [String(raw.dependsOn)] : []);
  const wave = Number(raw.wave);
  const ports = Number(raw.ports);
  const maxRepairs = Number(raw.maxRepairs);
  return {
    id: id || raw.id,
    title: String(raw.title).trim(),
    scope,
    deliver: String(raw.deliver).trim(),
    verify,
    verifySource,
    allowNoVerify,
    // BUG-09: una tarea sin cambios falla la ficha salvo que se declare que puede no tenerlos.
    allowEmptyDiff: Boolean(raw.allowEmptyDiff),
    accept: parseAccept(raw.accept),
    maxRepairs: Number.isInteger(maxRepairs) && maxRepairs >= 0 ? maxRepairs : 2,
    agent: raw.agent ? String(raw.agent) : undefined,
    model: raw.model ? String(raw.model) : undefined,
    // model-routing: rol y tamaño eligen agente y modelo desde .silka/routing.json (si existe).
    role: normalizeRole(raw.role),
    size: normalizeSize(raw.size),
    dependsOn,
    planId: raw.planId ? String(raw.planId) : undefined,
    wave: Number.isInteger(wave) && wave >= 0 ? wave : undefined,
    integrationRepairFor: raw.integrationRepairFor ? String(raw.integrationRepairFor) : undefined,
    ports: Number.isInteger(ports) && ports > 0 ? ports : 0,
    prompt: raw.prompt ? String(raw.prompt) : undefined,
    setup: raw.setup,
    setupMode: raw.setupMode === 'link' ? 'link' : (raw.setupMode === 'install' ? 'install' : undefined),
  };
}

export function validateTaskList(items, opts = {}) {
  if (!Array.isArray(items) || !items.length) {
    throw silkaError('E_TASK_INVALID', 'El plan debe ser una lista no vacía de tareas.');
  }
  return items.map((item) => normalizeTaskInput(item, opts));
}