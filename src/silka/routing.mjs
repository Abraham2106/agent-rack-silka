// model-routing (FR-MR-01..04): tabla versionada `.silka/routing.json` que asigna agente y modelo
// por rol (planificar, implementar, revisar) y tamaño (chica, media, grande).
//
// Formato:
//   { "version": 1,
//     "rules": {
//       "implementar": { "chica": { "agent": "codex", "models": ["gpt-a", "gpt-b"] } } } }
//
// Sin archivo, la tabla está vacía: toda tarea usa su explícito o el defecto (comportamiento actual).
import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from './codemode/errors.mjs';
import { unavailableModels } from './models.mjs';

export const ROLES = ['planificar', 'implementar', 'revisar'];
export const SIZES = ['chica', 'media', 'grande'];
export const DEFAULT_ROLE = 'implementar';
export const DEFAULT_SIZE = 'media';

export const routingFile = (repoRoot) => path.join(repoRoot, '.silka', 'routing.json');

/** Valida y normaliza el contenido de routing.json. Lanza E_TASK_INVALID si algo no cuadra. */
export function parseRouting(raw) {
  if (raw == null) return { version: 1, rules: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw silkaError('E_TASK_INVALID', 'routing.json debe ser un objeto con "rules".');
  }
  const rules = raw.rules ?? {};
  if (typeof rules !== 'object' || Array.isArray(rules)) {
    throw silkaError('E_TASK_INVALID', 'routing.json: "rules" debe ser un objeto por rol.');
  }
  const out = {};
  for (const role of Object.keys(rules)) {
    if (!ROLES.includes(role)) {
      throw silkaError('E_TASK_INVALID', `routing.json: rol desconocido "${role}" (usa ${ROLES.join(', ')}).`);
    }
    const bySize = rules[role] ?? {};
    if (typeof bySize !== 'object' || Array.isArray(bySize)) {
      throw silkaError('E_TASK_INVALID', `routing.json: el rol "${role}" debe mapear tamaños a reglas.`);
    }
    out[role] = {};
    for (const size of Object.keys(bySize)) {
      if (!SIZES.includes(size)) {
        throw silkaError('E_TASK_INVALID', `routing.json: tamaño desconocido "${size}" en el rol "${role}" (usa ${SIZES.join(', ')}).`);
      }
      const rule = bySize[size] ?? {};
      const models = rule.models == null ? [] : rule.models;
      if (!Array.isArray(models) || models.some((m) => typeof m !== 'string' || !m.trim())) {
        throw silkaError('E_TASK_INVALID', `routing.json: ${role}/${size}.models debe ser una lista de textos.`);
      }
      if (rule.agent != null && (typeof rule.agent !== 'string' || !rule.agent.trim())) {
        throw silkaError('E_TASK_INVALID', `routing.json: ${role}/${size}.agent debe ser un texto.`);
      }
      out[role][size] = {
        agent: rule.agent ? String(rule.agent).trim() : undefined,
        models: models.map((m) => m.trim()),
      };
    }
  }
  return { version: 1, rules: out };
}

/** Carga la tabla del repo. Sin archivo devuelve la tabla vacía (comportamiento actual). */
export function loadRouting(repoRoot) {
  const file = routingFile(repoRoot);
  if (!fs.existsSync(file)) return parseRouting(null);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw silkaError('E_TASK_INVALID', `routing.json no es JSON válido: ${err.message}`);
  }
  return parseRouting(raw);
}

/**
 * Resuelve agente y modelo de una tarea. Orden por campo: explícito de la tarea, regla de la tabla
 * para su rol y tamaño, y por último el defecto. Un modelo de la tabla marcado no disponible
 * (models.mjs) cae al siguiente de su lista y queda anotado en `fallback`.
 */
export function resolveRouting(task, { routing, defaultAgent = 'codex', defaultModel = '' } = {}) {
  const role = task.role || DEFAULT_ROLE;
  const size = task.size || DEFAULT_SIZE;
  const rule = routing?.rules?.[role]?.[size] || null;
  const unavailable = unavailableModels();
  const out = {
    role,
    size,
    agent: undefined,
    model: undefined,
    rule: 'defecto',
    agentRule: 'defecto',
    fallback: null,
  };

  if (task.agent) {
    out.agent = task.agent;
    out.agentRule = 'explícito';
  } else if (rule?.agent) {
    out.agent = rule.agent;
    out.agentRule = 'tabla';
  } else {
    out.agent = defaultAgent;
  }

  const agentForModel = out.agent;
  if (task.model) {
    out.model = task.model;
    out.rule = 'explícito';
    return out;
  }
  if (rule && rule.models.length) {
    const bad = unavailable[agentForModel] || {};
    const first = rule.models[0];
    const pick = rule.models.find((m) => !bad[m]);
    if (pick) {
      out.model = pick;
      out.rule = 'tabla';
      if (pick !== first) out.fallback = { from: first, to: pick, reason: 'no disponible con tu cuenta' };
      return out;
    }
    // Ninguno de la regla sirve: se usa el defecto y se avisa en la ficha.
    out.model = defaultModel || undefined;
    out.rule = 'defecto';
    out.fallback = { from: first, to: defaultModel || '(sin modelo por defecto)', reason: 'ningún modelo de la regla está disponible' };
    return out;
  }
  if (rule) {
    // La regla fija solo el agente: el modelo sigue el defecto.
    out.rule = 'tabla';
  }
  out.model = defaultModel || undefined;
  return out;
}

/** Texto para `silka routing show`: la tabla efectiva, con defaults si no hay archivo. */
export function formatRoutingTable(repoRoot, { defaultAgent = 'codex', defaultModel = '' } = {}) {
  const routing = loadRouting(repoRoot);
  const file = routingFile(repoRoot);
  const lines = [
    `Tabla de enrutado (${fs.existsSync(file) ? file : 'sin .silka/routing.json: defaults'})`,
    `Defecto: agente=${defaultAgent} modelo=${defaultModel || '(el del agente)'}`,
  ];
  for (const role of ROLES) {
    for (const size of SIZES) {
      const rule = routing.rules[role]?.[size];
      if (!rule) {
        lines.push(`  ${role}/${size}: defecto`);
        continue;
      }
      const models = rule.models.length ? rule.models.join(' > ') : '(modelo por defecto)';
      lines.push(`  ${role}/${size}: agente=${rule.agent || defaultAgent} modelos=${models}`);
    }
  }
  return lines.join('\n');
}
