// Catálogo de modelos por agente, leído de cada proveedor (nada escrito a mano).
//   cursor   → `cursor-agent --list-models`      (líneas "id - Nombre")
//   opencode → `opencode models`                  (líneas "proveedor/modelo")
//   codex    → ~/.codex/models_cache.json         (no tiene comando de lista)
// Se guarda en ~/.config/silka/models.json con TTL de 6 h. Los modelos que fallan con
// "no soportado" se recuerdan como no disponibles para tu cuenta.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';

export const MODELS_TTL_MS = 6 * 60 * 60 * 1000;
const IS_WIN = process.platform === 'win32';

const cacheFile = () => path.join(silkaConfigDir(), 'models.json');
const unavailableFile = () => path.join(silkaConfigDir(), 'models-unavailable.json');
const recentFile = () => path.join(silkaConfigDir(), 'recent-models.json');
const modelsLock = (name) => path.join(silkaConfigDir(), `${name}.lock`);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ---- parseo de cada fuente ---------------------------------------------------
export function parseCursorModels(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/[​-‍﻿]/g, '').trim();
    const m = /^([A-Za-z0-9][\w.:/-]*)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const name = m[2].trim();
    out.push({
      agent: 'cursor',
      id: m[1],
      name: name.replace(/\s*\((default|current)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
      provider: providerOf(m[1]),
      default: /\(default\)/i.test(name),
      free: false,
    });
  }
  return out;
}

export function parseOpencodeModels(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const id = raw.trim();
    if (!/^[\w.-]+\/\S+$/.test(id)) continue;
    const provider = id.split('/')[0];
    out.push({
      agent: 'opencode',
      id,
      name: id.slice(provider.length + 1),
      provider,
      free: /(^|[-:/])free($|[-:])/i.test(id),
      default: false,
    });
  }
  return out;
}

export function parseCodexCache(json) {
  const list = Array.isArray(json?.models) ? json.models : [];
  return list
    .filter((m) => m?.slug && m.visibility !== 'hide')
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => ({
      agent: 'codex',
      id: m.slug,
      name: m.display_name || m.slug,
      provider: 'openai',
      free: false,
      default: false,
      note: String(m.description || '').split(/[.\n]/)[0].slice(0, 60),
    }));
}

function providerOf(id) {
  const s = String(id).toLowerCase();
  if (/claude|sonnet|opus|haiku|fable/.test(s)) return 'anthropic';
  if (/gpt|codex|^o\d/.test(s)) return 'openai';
  if (/gemini/.test(s)) return 'google';
  if (/grok/.test(s)) return 'xai';
  if (/composer|cursor|auto/.test(s)) return 'cursor';
  return 'otros';
}

// ---- lectura de cada CLI -----------------------------------------------------
function run(cmd, args, timeout = 30_000) {
  return new Promise((resolve) => {
    // shell en Windows: los CLIs de npm son .cmd; los args aquí son fijos, sin texto del usuario.
    execFile(cmd, args, { timeout, windowsHide: true, shell: IS_WIN, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), error: error ? String(stderr || error.message).trim().split('\n')[0] : '' });
    });
  });
}

const SOURCES = {
  async cursor() {
    const r = await run('cursor-agent', ['--list-models']);
    const models = parseCursorModels(r.stdout);
    return { models, error: models.length ? '' : (r.error || 'cursor-agent no devolvió modelos') };
  },
  async opencode() {
    const r = await run('opencode', ['models'], 60_000);
    const models = parseOpencodeModels(r.stdout);
    return { models, error: models.length ? '' : (r.error || 'opencode no devolvió modelos') };
  },
  async codex() {
    const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
    const json = readJson(file, null);
    const models = parseCodexCache(json);
    return { models, error: models.length ? '' : `no encontré ${file} (abre codex una vez para que lo cree)` };
  },
};

// ---- caché -------------------------------------------------------------------
export function readCatalogCache() {
  const raw = readJson(cacheFile(), {});
  return raw && typeof raw === 'object' ? raw : {};
}

function fresh(entry, now = Date.now()) {
  return entry && Date.parse(entry.at) > now - MODELS_TTL_MS;
}

/** Catálogo de un agente. Usa la caché si está fresca; `refresh` fuerza leer el CLI. */
export async function loadModels(agent, { refresh = false, all = false } = {}) {
  const cache = readCatalogCache();
  if (!refresh && fresh(cache[agent])) return decorate(agent, cache[agent].models, cache[agent].error, { all });
  const source = SOURCES[agent];
  if (!source) return decorate(agent, [], `no sé leer el catálogo de ${agent}`);
  const { models, error } = await source();
  // Si el CLI falla pero había una lista vieja, se queda la vieja.
  const keep = models.length ? models : (cache[agent]?.models || []);
  const next = { ...readCatalogCache(), [agent]: { at: new Date().toISOString(), models: keep, error } };
  try {
    withFileLock(modelsLock('models-cache'), () => {
      writeAtomic(cacheFile(), `${JSON.stringify(next)}\n`);
    });
  } catch { /* la caché es opcional */ }
  return decorate(agent, keep, error, { all });
}

/** Lo que hay en caché, sin esperar a ningún CLI (para pintar al instante). */
export function cachedModels(agent) {
  const entry = readCatalogCache()[agent];
  return decorate(agent, entry?.models || [], entry?.error || '');
}

// ---- filtros por agente ------------------------------------------------------
// ~/.config/silka/model-filters.json: { "cursor": ["grok-4\\.7", ...], "opencode": ["-free"] }
// Cada patrón es una regex (sin distinguir mayúsculas) sobre el id. Vacío = todos.
const filtersFile = () => path.join(silkaConfigDir(), 'model-filters.json');

export function modelFilters() {
  const raw = readJson(filtersFile(), {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function setModelFilter(agent, patterns) {
  const all = modelFilters();
  if (patterns?.length) all[agent] = patterns;
  else delete all[agent];
  withFileLock(modelsLock('model-filters'), () => {
    writeAtomic(filtersFile(), `${JSON.stringify(all, null, 2)}\n`);
  });
  return all[agent] || [];
}

export function applyFilter(models, patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return models;
  const res = patterns.map((p) => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
  return models.filter((m) => res.some((re) => re.test(m.id)));
}

function decorate(agent, models, error, { all = false } = {}) {
  const bad = unavailableModels()[agent] || {};
  const shown = all ? models : applyFilter(models, modelFilters()[agent]);
  return {
    agent,
    error: error || '',
    total: models.length,
    models: shown.map((m) => ({ ...m, available: !bad[m.id], note: bad[m.id] ? 'no disponible con tu cuenta' : m.note })),
  };
}

// ---- no disponibles y recientes ---------------------------------------------
export function unavailableModels() {
  return readJson(unavailableFile(), {}) || {};
}

const UNSUPPORTED = /not supported|unsupported|model_not_found|no existe|not found|invalid model|unknown model|does not exist/i;

/** Si un error dice que el modelo no sirve para esta cuenta, lo recordamos. */
export function noteModelError(agent, model, errorText) {
  if (!agent || !model || !UNSUPPORTED.test(String(errorText || ''))) return false;
  try {
    withFileLock(modelsLock('models-unavailable'), () => {
      const fresh = readJson(unavailableFile(), {}) || {};
      fresh[agent] = { ...(fresh[agent] || {}), [model]: new Date().toISOString() };
      writeAtomic(unavailableFile(), `${JSON.stringify(fresh, null, 2)}\n`);
    });
  } catch {
    return false;
  }
  return true;
}

export function recentModels(agent) {
  const all = readJson(recentFile(), {}) || {};
  return Array.isArray(all[agent]) ? all[agent] : [];
}

export function rememberRecentModel(agent, model) {
  if (!agent || !model) return;
  try {
    withFileLock(modelsLock('recent-models'), () => {
      const fresh = readJson(recentFile(), {}) || {};
      fresh[agent] = [model, ...(fresh[agent] || []).filter((m) => m !== model)].slice(0, 5);
      writeAtomic(recentFile(), `${JSON.stringify(fresh, null, 2)}\n`);
    });
  } catch { /* opcional */ }
}

// ---- búsqueda ----------------------------------------------------------------
/** Puntaje difuso: subsecuencia de la consulta en id+nombre; premia prefijo y contigüidad. */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, '');
  const t = String(text || '').toLowerCase();
  if (!q) return 1;
  let ti = 0; let score = 0; let run = 0; let first = -1;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    if (first < 0) first = at;
    run = at === ti ? run + 1 : 0;
    score += 1 + run * 2;
    ti = at + 1;
  }
  if (t.includes(q)) score += 10;
  if (first === 0) score += 5;
  return score - Math.min(first, 20) * 0.1;
}

/**
 * Lista para el selector: por defecto y recientes primero; luego por proveedor.
 * Los no disponibles van al final. Con consulta, ordena por puntaje.
 */
export function pickerItems(catalog, { query = '', defaultModel = '', recents = [] } = {}) {
  const models = catalog?.models || [];
  const byId = new Map(models.map((m) => [m.id, m]));
  const tag = (m, extra) => ({ ...m, isDefault: m.id === defaultModel, isRecent: recents.includes(m.id), ...extra });
  if (String(query).trim()) {
    return models
      .map((m) => ({ m, s: fuzzyScore(query, `${m.id} ${m.name} ${m.provider}`) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (Number(b.m.available) - Number(a.m.available)) || (b.s - a.s))
      .map((x) => tag(x.m));
  }
  const top = [defaultModel, ...recents].filter((id, i, all) => id && all.indexOf(id) === i && byId.has(id));
  const rest = models.filter((m) => !top.includes(m.id))
    .sort((a, b) => (Number(b.available) - Number(a.available)) || a.provider.localeCompare(b.provider));
  return [...top.map((id) => tag(byId.get(id))), ...rest.map((m) => tag(m))];
}

/** Escribe el modelo por defecto de un agente en agent-rack.config.json. */
export function setDefaultModel(configPath, agent, model) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.agents?.[agent]) throw new Error(`El agente '${agent}' no está en la config.`);
  if (model) config.agents[agent].model = model;
  else delete config.agents[agent].model;
  writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config.agents[agent];
}
