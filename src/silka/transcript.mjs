import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';
import { redactSecrets } from './redact.mjs';
import { matchTaskSession, readStore, rememberTurnLink, samePath } from './state.mjs';
import { originLabel } from './origin.mjs';

const NEAR_MS = 1500;

function transcriptsDir() {
  return path.join(silkaConfigDir(), 'transcripts');
}

export function turnTranscriptPath(turnId) {
  return path.join(transcriptsDir(), 'turns', `${safeId(turnId)}.jsonl`);
}

export function sessionTranscriptPath(sessionId) {
  return path.join(transcriptsDir(), `${safeId(sessionId)}.jsonl`);
}

function safeId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error('Id de historial inválido.');
  return id;
}

function appendJsonl(file, event) {
  const line = `${JSON.stringify(event)}\n`;
  withFileLock(`${file}.lock`, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  });
}

function readJsonl(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const events = [];
  for (const line of raw.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === 'object') events.push(event);
    } catch { /* una línea rota no tira el resto */ }
  }
  return events;
}

function clipText(value, max = 4000) {
  const text = redactSecrets(String(value ?? ''));
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Asociación turno ↔ sesión de agent-rack.
 *
 * El shim no recibe el sessionId: agent-rack crea la sesión en el hub y
 * después lanza este proceso. En disco solo queda la tarea
 * (.silka/tasks.json: id, agent, workspace, startedAt, pid) y, si el hub
 * responde, la lista de sesiones (sessionId, agentId, workspace, createdAt).
 *
 * 1. Si la tarea ya tiene sessionId, es ese. No se vuelve a adivinar.
 * 2. Si no, matchTaskSession se queda con las sesiones del mismo workspace
 *    y el mismo agente, y elige la de createdAt más cercano a startedAt.
 *    El hub crea la sesión y enseguida arranca el shim, así que esa
 *    distancia es de segundos. Las sesiones viejas quedan lejos.
 * 3. Si dos sesiones quedan a menos de 1.5s (dos agentes iguales lanzados
 *    juntos), se prefiere la que no tenga ya otro turno en curso en
 *    `claimed` (sessionId → turnId). Así no se pisan.
 */
export function associateTurn(task, sessions, claimed = new Map()) {
  if (!task) return '';
  if (task.sessionId) return String(task.sessionId);
  const ready = { ...task, workspace: task.workspace || '' };
  const match = matchTaskSession(ready, sessions);
  if (!match?.sessionId) return '';
  const workspacePool = (sessions || []).filter((session) => samePath(session.workspace, ready.workspace));
  const sameAgent = workspacePool.filter((session) => originLabel(session.agentId) === originLabel(task.agent));
  const pool = sameAgent.length ? sameAgent : workspacePool;
  const target = Date.parse(task.startedAt);
  const ranked = pool.map((session) => {
    const delta = Math.abs(Date.parse(session.createdAt) - target);
    return { session, delta: Number.isFinite(delta) ? delta : Number.POSITIVE_INFINITY };
  }).sort((a, b) => a.delta - b.delta);
  const best = ranked[0];
  if (!best) return match.sessionId;
  const near = ranked.filter((row) => row.delta - best.delta < NEAR_MS);
  if (near.length <= 1) return match.sessionId;
  const free = near.find((row) => {
    const owner = claimed.get(row.session.sessionId);
    return !owner || owner === task.id;
  });
  return (free || best).session.sessionId || match.sessionId;
}

/** Turnos en curso que ya tienen sesión, para el desempate de associateTurn. */
export function claimedSessions(tasks) {
  const map = new Map();
  for (const task of tasks || []) {
    if (task?.sessionId && task.status === 'running') map.set(task.sessionId, task.id);
  }
  return map;
}

function writeEvent(ctx, fields) {
  ctx.n = (ctx.n || 0) + 1;
  const event = {
    id: crypto.randomUUID(),
    n: ctx.n,
    at: new Date().toISOString(),
    turnId: ctx.turnId,
    sessionId: ctx.sessionId || '',
    kind: fields.kind,
    author: originLabel(fields.author || ctx.author || 'tú'),
    text: clipText(fields.text || ''),
  };
  if (fields.tool) {
    event.tool = {
      name: clipText(fields.tool.name || 'tool', 80),
      target: clipText(fields.tool.target || '', 240),
      status: fields.tool.status || 'done',
      detail: clipText(fields.tool.detail || fields.tool.line || '', 4000),
    };
    if (!event.text) event.text = event.tool.detail || event.tool.target || event.tool.name;
  }
  if (fields.conversation?.id) {
    event.conversation = {
      kind: String(fields.conversation.kind || ''),
      id: String(fields.conversation.id),
    };
  }
  appendJsonl(turnTranscriptPath(ctx.turnId), event);
  if (ctx.sessionId) appendJsonl(sessionTranscriptPath(ctx.sessionId), { ...event, sessionId: ctx.sessionId });
  return event;
}

function copyTurn(turnId, sessionId) {
  const have = new Set(readJsonl(sessionTranscriptPath(sessionId)).map((event) => event.id));
  for (const event of readJsonl(turnTranscriptPath(turnId))) {
    if (!event?.id || have.has(event.id)) continue;
    have.add(event.id);
    appendJsonl(sessionTranscriptPath(sessionId), { ...event, sessionId });
  }
}

async function defaultListSessions() {
  const { loadSilkaConfig, readRuntime, pidAlive } = await import('./hub.mjs');
  const cfg = loadSilkaConfig();
  const runtime = readRuntime(cfg.port);
  if (!runtime?.token || !pidAlive(runtime.pid)) return [];
  const { DashboardRemoteClient } = await import('agent-rack/dist/cli/dashboard/remoteClient.js');
  const client = new DashboardRemoteClient(`http://127.0.0.1:${cfg.port}/sse`, runtime.token);
  await client.connect();
  try {
    const list = await client.listSessions();
    return Array.isArray(list) ? list : [];
  } finally {
    await client.close().catch(() => {});
  }
}

function withTimeout(promise, ms) {
  const guarded = Promise.resolve(promise).catch(() => []);
  return Promise.race([
    guarded,
    new Promise((resolve) => { setTimeout(() => resolve([]), ms); }),
  ]);
}

/** Copia el turno al jsonl de la sesión en cuanto se puede asociar. */
export async function flushTurn(ctx, listSessions = defaultListSessions) {
  if (!ctx?.turnId) return '';
  if (!ctx.sessionId) {
    let sessions = [];
    try { sessions = await withTimeout(Promise.resolve().then(() => listSessions()), 2500) || []; } catch { sessions = []; }
    let task = null;
    try {
      task = readStore(ctx.workspace).tasks.find((item) => item.id === ctx.turnId) || null;
    } catch { task = null; }
    if (task) {
      const claimed = claimedSessions(readStore(ctx.workspace).tasks.filter((item) => item.id !== task.id));
      ctx.sessionId = associateTurn({ ...task, workspace: task.workspace || ctx.workspace }, sessions, claimed);
    }
  }
  if (!ctx.sessionId) return '';
  try {
    rememberTurnLink({
      workspace: ctx.workspace,
      id: ctx.turnId,
      sessionId: ctx.sessionId,
      conversation: ctx.conversationId ? { kind: ctx.conversationKind, id: ctx.conversationId } : null,
    });
  } catch { /* el enlace no debe tumbar al agente */ }
  try { copyTurn(ctx.turnId, ctx.sessionId); } catch { /* se reintenta al leer */ }
  return ctx.sessionId;
}

/**
 * Historial de un turno. Escribe ya en transcripts/turns/<turnId>.jsonl
 * (redactado) y, cuando conoce la sesión, también en transcripts/<sesión>.jsonl.
 */
export function createTurnLog({ turnId, workspace, agent, author, prompt, listSessions } = {}) {
  const ctx = {
    turnId,
    workspace: workspace || process.cwd(),
    agent: originLabel(agent),
    author: originLabel(author || 'tú'),
    sessionId: '',
    conversationId: '',
    conversationKind: '',
    lastAgent: '',
    flushing: null,
  };
  const kick = () => {
    if (ctx.flushing) return ctx.flushing;
    ctx.flushing = flushTurn(ctx, listSessions).finally(() => { ctx.flushing = null; });
    return ctx.flushing;
  };
  if (turnId) writeEvent(ctx, { kind: 'user', author: ctx.author, text: prompt || '' });
  kick();
  return {
    tool(info = {}) {
      if (!turnId) return;
      writeEvent(ctx, { kind: 'tool', author: ctx.agent, text: info.line || info.target || '', tool: info });
    },
    agent(text) {
      if (!turnId) return;
      const clean = clipText(text, 2000).replace(/\s+/g, ' ').trim();
      if (!clean || clean === ctx.lastAgent) return;
      ctx.lastAgent = clean;
      writeEvent(ctx, { kind: 'agent', author: ctx.agent, text: clean });
    },
    interrupt(text) {
      if (!turnId) return;
      writeEvent(ctx, { kind: 'interrupt', author: 'tú', text: text || 'interrumpido por el usuario' });
      kick();
    },
    conversation(kind, id) {
      if (!turnId || !id || ctx.conversationId === id) return;
      ctx.conversationId = String(id);
      ctx.conversationKind = String(kind || '');
      writeEvent(ctx, {
        kind: 'status',
        author: ctx.agent,
        text: '',
        conversation: { kind: ctx.conversationKind, id: ctx.conversationId },
      });
      try {
        rememberTurnLink({
          workspace: ctx.workspace,
          id: turnId,
          conversation: { kind: ctx.conversationKind, id: ctx.conversationId },
        });
      } catch { /* sigue el turno */ }
      kick();
    },
    finish(text) {
      if (text) this.agent(text);
      const pending = ctx.flushing;
      return Promise.resolve(pending).then(() => flushTurn(ctx, listSessions));
    },
  };
}

/** Reconstruye la conversación desde el jsonl de la sesión y los turnos que le corresponden. */
export function readConversation(sessionId, { tasks = [], sessions = [] } = {}) {
  if (!sessionId) return [];
  const events = [];
  const seen = new Set();
  const push = (event) => {
    if (!event?.id || seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };
  try {
    for (const event of readJsonl(sessionTranscriptPath(sessionId))) push(event);
  } catch { /* sin archivo de sesión: valen los turnos */ }
  const others = (tasks || []).filter((task) => task?.sessionId && task.sessionId !== sessionId);
  const claimed = claimedSessions(others);
  for (const task of tasks || []) {
    if (!task?.id) continue;
    let linked = '';
    try {
      linked = task.sessionId || associateTurn(
        { ...task, workspace: task.workspace || '' },
        sessions,
        claimed,
      );
    } catch { linked = task.sessionId || ''; }
    if (linked !== sessionId) continue;
    if (!task.sessionId) claimed.set(sessionId, task.id);
    try {
      for (const event of readJsonl(turnTranscriptPath(task.id))) push(event);
    } catch { /* un turno ilegible no borra el resto */ }
  }
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)) || (Number(a.n) || 0) - (Number(b.n) || 0));
  return events;
}
