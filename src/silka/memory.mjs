// Memoria mínima de Silka (openspec: agent-memory). Vive en `.silka/decisions.jsonl`, el mismo
// registro que ya guarda las decisiones: las filas viejas (sin `kind`) siguen siendo decisiones.
// Reglas: las entradas no se borran, se marcan (vencida o reemplazada); las propuestas de fichas
// fallidas quedan pendientes hasta confirmarlas; solo las vigentes con etiqueta de alcance se
// inyectan en el encargo de una tarea, dentro de un tope de tamaño.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './lock.mjs';
import { originLabel } from './origin.mjs';

export const MEMORY_TYPES = ['decisión', 'aprendizaje', 'preferencia'];
export const MEMORY_STATUS = ['vigente', 'pendiente', 'vencida', 'reemplazada'];
export const MEMORY_BUDGET_BYTES = 2048;

// Aprendizajes ya conocidos del proyecto. `seedMemory` los carga una vez por workspace.
const KNOWN_LEARNINGS = [
  {
    key: 'soltar-junction-antes-de-borrar',
    type: 'aprendizaje',
    tags: ['src/silka/tasks/'],
    text: 'Antes de borrar un worktree en Windows, soltar primero el enlace de node_modules con '
      + '`cmd /c rmdir node_modules` (sin /s) y comprobar que el node_modules del repo sigue intacto.',
  },
  {
    key: 'un-solo-hub',
    type: 'aprendizaje',
    tags: ['src/silka/tasks/', 'src/silka/bridge.mjs'],
    text: 'Antes de lanzar tareas, comprobar que hay un solo hub y que no corre código viejo: el bridge MCP '
      + 'de una sesión anterior puede llevar código de antes de los últimos cambios.',
  },
];

function memoryDir(workspace) {
  return path.join(path.resolve(String(workspace)), '.silka');
}

function memoryFile(workspace) {
  return path.join(memoryDir(workspace), 'decisions.jsonl');
}

function oneLine(value, max = 88) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function normTag(tag) {
  return String(tag ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(/[,;\n]/);
  return [...new Set(list.map(normTag).filter(Boolean))];
}

function appendRow(workspace, row) {
  const dir = memoryDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  // Mismo lock que usa state.mjs para .silka/tasks.json y decisions.jsonl.
  withFileLock(path.join(dir, '.lock'), () => {
    fs.appendFileSync(memoryFile(workspace), `${JSON.stringify(row)}\n`);
  });
}

/** Filas crudas del archivo, con su id estable (las viejas no lo tienen: se usa su línea). */
function readRaw(workspace) {
  let text;
  try {
    text = fs.readFileSync(memoryFile(workspace), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') out.push({ row, id: row.id ? String(row.id) : `l${index}` });
    } catch { /* línea corrupta: se ignora, como antes */ }
  });
  return out;
}

/** Todas las entradas de memoria con su estado vigente (las marcas se aplican por id). */
export function readMemory(workspace) {
  const entries = [];
  const byId = new Map();
  for (const { row, id } of readRaw(workspace)) {
    if (row.op === 'mark') {
      const entry = byId.get(String(row.id));
      if (entry && MEMORY_STATUS.includes(row.status)) {
        entry.status = row.status;
        if (row.replacedBy) entry.replacedBy = String(row.replacedBy);
      }
      continue;
    }
    if (row.op) continue; // registro de fallos u otras filas internas
    const text = String(row.text ?? '').trim();
    if (!text) continue;
    const entry = {
      id,
      at: String(row.at || ''),
      author: String(row.author || 'tú'),
      sessionId: String(row.sessionId || ''),
      type: MEMORY_TYPES.includes(row.kind) ? row.kind : 'decisión',
      text,
      tags: Array.isArray(row.tags) ? normalizeTags(row.tags) : [],
      source: String(row.source || ''),
      status: MEMORY_STATUS.includes(row.status) ? row.status : 'vigente',
      replaces: row.replaces ? String(row.replaces) : '',
      causeKey: row.causeKey ? String(row.causeKey) : '',
    };
    entries.push(entry);
    byId.set(id, entry);
  }
  return entries;
}

/** Solo decisiones vigentes: forma que ya usa el estado del proyecto (state.mjs). */
export function readVigentDecisions(workspace) {
  return readMemory(workspace).filter((entry) => entry.status === 'vigente');
}

export function addMemory(workspace, {
  type = 'decisión', text, tags = [], author = 'tú', sessionId = '', source = '', status = 'vigente', replaces = '', causeKey = '',
} = {}) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new Error(`Tipo de memoria no válido: ${type}. Usa ${MEMORY_TYPES.join(', ')}.`);
  }
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('La entrada de memoria está vacía.');
  const row = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    author: originLabel(author || 'tú'),
    sessionId: String(sessionId || ''),
    kind: type,
    text: clean,
    tags: normalizeTags(tags),
    source: String(source || ''),
    status,
  };
  if (replaces) row.replaces = String(replaces);
  if (causeKey) row.causeKey = String(causeKey);
  appendRow(workspace, row);
  const { kind, ...rest } = row;
  return { ...rest, type: kind };
}

/** Marca una entrada (vencida o reemplazada); la fila original no se toca. */
export function setMemoryStatus(workspace, id, status, { by = 'tú', replacedBy = '' } = {}) {
  if (!MEMORY_STATUS.includes(status)) throw new Error(`Estado de memoria no válido: ${status}.`);
  const entry = readMemory(workspace).find((item) => item.id === String(id));
  if (!entry) throw new Error(`Entrada de memoria no encontrada: ${id}`);
  if (entry.status === status) return entry;
  const mark = { op: 'mark', id: entry.id, status, at: new Date().toISOString(), author: originLabel(by || 'tú') };
  if (replacedBy) mark.replacedBy = String(replacedBy);
  appendRow(workspace, mark);
  return { ...entry, status, replacedBy: replacedBy || entry.replacedBy };
}

/** Una propuesta pendiente pasa a vigente: solo el humano o el manager la confirman. */
export function confirmMemory(workspace, id, { by = 'tú' } = {}) {
  const entry = readMemory(workspace).find((item) => item.id === String(id));
  if (!entry) throw new Error(`Entrada de memoria no encontrada: ${id}`);
  if (entry.status !== 'pendiente') throw new Error(`La entrada ${id} no está pendiente (estado: ${entry.status}).`);
  return setMemoryStatus(workspace, id, 'vigente', { by });
}

export function expireMemory(workspace, id, { by = 'tú' } = {}) {
  return setMemoryStatus(workspace, id, 'vencida', { by });
}

/** Sustituye una entrada: la nueva queda vigente y la vieja marcada como reemplazada. */
export function replaceMemory(workspace, id, text, { by = 'tú' } = {}) {
  const old = readMemory(workspace).find((item) => item.id === String(id));
  if (!old) throw new Error(`Entrada de memoria no encontrada: ${id}`);
  const row = addMemory(workspace, {
    type: old.type, text, tags: old.tags, author: by, source: old.source, replaces: old.id,
  });
  setMemoryStatus(workspace, old.id, 'reemplazada', { by, replacedBy: row.id });
  return row;
}

/** Peso de una etiqueta frente al alcance de la tarea; 0 si no aplica. */
function tagScore(tag, scope) {
  if (tag === '*') return 0.5;
  const t = normTag(tag).toLowerCase().replace(/\/$/, '');
  const s = normTag(scope).toLowerCase().replace(/\/$/, '');
  if (!t || !s) return 0;
  if (s === t || s.startsWith(`${t}/`) || t.startsWith(`${s}/`)) return 1 + Math.min(t.length, 200) / 1000;
  return 0;
}

export function relevanceScore(tags, scopes) {
  let best = 0;
  for (const tag of tags || []) {
    for (const scope of scopes || []) best = Math.max(best, tagScore(tag, scope));
  }
  return best;
}

/**
 * Entradas vigentes para un alcance, por relevancia y luego por fecha. Lo que no cabe en el tope
 * (por defecto 2 KB) queda en `rest` y se cita por referencia, no como texto.
 */
export function selectMemory(workspace, scope = [], { budget = MEMORY_BUDGET_BYTES } = {}) {
  const scopes = [scope].flat().map(String).filter(Boolean);
  const ranked = readVigentDecisions(workspace)
    .map((entry) => ({ entry, score: relevanceScore(entry.tags, scopes) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || b.entry.at.localeCompare(a.entry.at));
  const picked = [];
  const rest = [];
  let used = 0;
  for (const { entry } of ranked) {
    const bytes = Buffer.byteLength(`- [${entry.type}] ${oneLine(entry.text, 600)}\n`, 'utf8');
    if (used + bytes <= budget) {
      picked.push(entry);
      used += bytes;
    } else {
      rest.push(entry);
    }
  }
  return { picked, rest };
}

/** Bloque que se antepone al encargo de una tarea. Vacío si no hay nada relevante. */
export function memoryPrefix(workspace, scope = []) {
  let selected;
  try {
    selected = selectMemory(workspace, scope);
  } catch {
    return ''; // la memoria nunca debe impedir lanzar una tarea
  }
  if (!selected.picked.length && !selected.rest.length) return '';
  const scopeLabel = [scope].flat().filter(Boolean).join(', ') || '.';
  const lines = ['Memoria del proyecto (silka), vigente para este alcance:'];
  for (const entry of selected.picked) lines.push(`- [${entry.type}] ${oneLine(entry.text, 600)}`);
  if (selected.rest.length) {
    lines.push(`Otras ${selected.rest.length} entradas no caben en el tope: .silka/decisions.jsonl `
      + `(silka memory ls --scope ${scopeLabel}).`);
  }
  return `${lines.join('\n')}\n\n`;
}

function causeKeyOf(reason) {
  return String(reason ?? '').toLowerCase()
    .replace(/[a-z]:[\\/][^\s'"]*/g, '<ruta>')
    .replace(/\b[0-9a-f]{7,}\b/g, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Registra el fallo de una ficha. Si otra tarea falló ya por la misma causa, propone un aprendizaje
 * PENDIENTE: no se inyecta hasta que el humano o el manager lo confirmen.
 */
export function recordFailure(workspace, { taskId, scope = [], reason = '' }) {
  const key = causeKeyOf(reason);
  if (!key) return null;
  const rows = readRaw(workspace);
  const prior = rows.filter(({ row }) => row.op === 'fallo' && row.causeKey === key && row.taskId !== taskId);
  appendRow(workspace, { op: 'fallo', at: new Date().toISOString(), taskId: String(taskId), causeKey: key });
  if (!prior.length) return null;
  const already = readMemory(workspace).some((entry) => entry.causeKey === key
    && (entry.status === 'pendiente' || entry.status === 'vigente'));
  if (already) return null;
  return addMemory(workspace, {
    type: 'aprendizaje',
    text: `Fallo repetido en ${prior.length + 1} tareas: ${oneLine(reason, 160)}. Revisar esa causa antes de repetir el encargo.`,
    tags: normalizeTags(scope),
    author: 'silka',
    source: `ficha:${taskId}`,
    status: 'pendiente',
    causeKey: key,
  });
}

/** Igual que recordFailure, pero nunca lanza: un fallo de memoria no debe frenar al manager. */
export function noteTaskFailure(workspace, task, reason) {
  try {
    return recordFailure(workspace, { taskId: task.id, scope: task.scope, reason });
  } catch {
    return null;
  }
}

/** Carga los aprendizajes conocidos una sola vez por workspace (idempotente). */
export function seedMemory(workspace) {
  const have = new Set(readRaw(workspace).map(({ row }) => row.source).filter(Boolean));
  const added = [];
  for (const seed of KNOWN_LEARNINGS) {
    const source = `semilla:${seed.key}`;
    if (have.has(source)) continue;
    added.push(addMemory(workspace, { type: seed.type, text: seed.text, tags: seed.tags, author: 'silka', source }));
  }
  return added;
}

function parseFlags(args) {
  const flags = { tag: [] };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === 'all') {
      flags.all = true;
      continue;
    }
    const value = args[i + 1];
    i += 1;
    if (name === 'tag') flags.tag.push(value);
    else flags[name] = value;
  }
  return { flags, positional };
}

function formatRow(entry) {
  return [entry.id, entry.status, entry.type, entry.tags.join(',') || '-', oneLine(entry.text, 120)].join('\t');
}

/** Entradas para listar: por defecto vigentes y pendientes; con `all`, también vencidas y reemplazadas. */
export function listMemory(workspace, { all = false, scope = '' } = {}) {
  let entries = readMemory(workspace).filter((entry) => all || entry.status === 'vigente' || entry.status === 'pendiente');
  if (scope) entries = entries.filter((entry) => relevanceScore(entry.tags, [scope]) > 0);
  return entries;
}

/** silka memory add|ls|confirm|expire|replace (ver openspec/changes/agent-memory). */
export function memoryCommand(argv, cwd = process.cwd()) {
  const [sub, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const ws = flags.workspace || cwd;
  if (sub === 'add') {
    const [type, ...words] = positional;
    const row = addMemory(ws, { type, text: words.join(' '), tags: flags.tag, author: flags.by || 'tú' });
    console.log(`memoria ${row.id} (${row.type}) guardada`);
    return row;
  }
  if (sub === 'ls') {
    const entries = listMemory(ws, { all: Boolean(flags.all), scope: flags.scope || '' });
    if (!entries.length) console.log('sin entradas de memoria');
    for (const entry of entries) console.log(formatRow(entry));
    return entries;
  }
  if (sub === 'confirm') {
    const row = confirmMemory(ws, positional[0], { by: flags.by || 'tú' });
    console.log(`memoria ${row.id} confirmada (vigente)`);
    return row;
  }
  if (sub === 'expire') {
    const row = expireMemory(ws, positional[0], { by: flags.by || 'tú' });
    console.log(`memoria ${row.id} marcada como vencida`);
    return row;
  }
  if (sub === 'replace') {
    const [id, ...words] = positional;
    const row = replaceMemory(ws, id, words.join(' '), { by: flags.by || 'tú' });
    console.log(`memoria ${id} reemplazada por ${row.id}`);
    return row;
  }
  throw new Error('Uso: silka memory add <decisión|aprendizaje|preferencia> "<texto>" [--tag ruta]... | ls [--all] [--scope ruta] | confirm <id> | expire <id> | replace <id> "<texto>"');
}
