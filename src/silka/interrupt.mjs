import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './lock.mjs';
import { originLabel } from './origin.mjs';
import { silkaConfigDir } from './paths.mjs';
import { readStore, samePath } from './state.mjs';

/** Tope para no cortar a medias una herramienta que escribe o ejecuta algo. */
export const TOOL_WAIT_MS = 5_000;

const READ_ONLY = /read|grep|glob|list|^ls$|search|find|view|fetch|web|todo|reasoning|think/i;
/** Solo esperamos herramientas que escriben o ejecutan; una lectura se puede cortar sin riesgo. Desconocida = esperar. */
export function isMutatingTool(kind) {
  const name = String(kind || '');
  if (!name) return true;
  return !READ_ONLY.test(name);
}

export function interruptDir() {
  return path.join(silkaConfigDir(), 'interrupt');
}

function safeTurnId(turnId) {
  return String(turnId || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

/** Las órdenes se indexan por id de turno (C-05), no por PID. */
export function interruptPath(turnId) {
  const id = String(turnId || '').trim();
  if (!id) throw new Error('Id de turno inválido.');
  return path.join(interruptDir(), `${safeTurnId(id)}.json`);
}

export function sessionTurnDir() {
  return path.join(silkaConfigDir(), 'session-turn');
}

function safeSessionId(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export function sessionTurnPath(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) throw new Error('sessionId inválido.');
  return path.join(sessionTurnDir(), `${safeSessionId(id)}.json`);
}

/** Enlace explícito sesión ↔ turno (C-06). */
export function writeSessionTurnLink({ sessionId, turnId, workspace = '' } = {}) {
  if (!sessionId || !turnId) return null;
  fs.mkdirSync(sessionTurnDir(), { recursive: true });
  const body = {
    sessionId: String(sessionId),
    turnId: String(turnId),
    workspace: workspace ? String(workspace) : '',
    at: new Date().toISOString(),
  };
  writeAtomic(sessionTurnPath(sessionId), `${JSON.stringify(body)}\n`);
  return body;
}

export function readSessionTurnLink(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionTurnPath(sessionId), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSessionTurnLink(sessionId) {
  try { fs.rmSync(sessionTurnPath(sessionId), { force: true }); } catch { /* ya no está */ }
}

function tasksFor(session, tasks) {
  if (Array.isArray(tasks)) return tasks;
  if (session?.workspace) return readStore(session.workspace).tasks;
  return [];
}

/** Turno activo de la sesión: enlace explícito o tarea con sessionId (sin heurística temporal). */
export function turnForSession(session, tasks) {
  if (!session?.sessionId) return '';
  const link = readSessionTurnLink(session.sessionId);
  if (link?.turnId) return String(link.turnId);
  const list = tasksFor(session, tasks);
  const running = list.filter((task) => task?.status === 'running' && task.sessionId === session.sessionId);
  if (running.length === 1) return String(running[0].id);
  return '';
}

export function writeInterrupt(order) {
  const turnId = String(order?.turnId || order?.id || '').trim();
  if (!turnId) throw new Error('Falta turnId en la orden de interrupción.');
  const file = interruptPath(turnId);
  const body = {
    turnId,
    pid: Number(order.pid) || 0,
    sessionId: String(order.sessionId || ''),
    messageId: String(order.messageId || ''),
    text: String(order.text || ''),
    author: originLabel(order.author || 'tú'),
    at: new Date().toISOString(),
  };
  writeAtomic(file, `${JSON.stringify(body)}\n`);
  return body;
}

export function readInterrupt(turnId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(interruptPath(turnId), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearInterrupt(turnId) {
  try { fs.rmSync(interruptPath(turnId), { force: true }); } catch { /* ya no está */ }
}

/** Compatibilidad: pid del shim del turno enlazado a la sesión. */
export function shimPidForSession(session, tasks) {
  const turnId = turnForSession(session, tasks);
  if (!turnId) return 0;
  const task = tasksFor(session, tasks).find((item) => String(item?.id) === turnId);
  const pid = Number(task?.pid);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

/**
 * Al crear una sesión en el hub, enlázala al turno en curso sin sessionId en
 * el mismo workspace y agente (mínimo bridge C-06).
 */
export function linkSessionToStartingTurn(sessionId, { workspace, agentId, tasks } = {}) {
  if (!sessionId || !workspace) return false;
  const list = Array.isArray(tasks) ? tasks : readStore(workspace).tasks;
  const agent = originLabel(agentId);
  const open = list.filter((task) => task?.status === 'running' && !task.sessionId && samePath(task.workspace, workspace)
    && originLabel(task.agent) === agent);
  if (open.length !== 1) return false;
  writeSessionTurnLink({ sessionId, turnId: open[0].id, workspace });
  return true;
}

export function cursorToolPhase(ev) {
  if (!ev || String(ev.type || '') !== 'tool_call') return null;
  const id = String(ev.call_id || ev.callId || ev.tool_call_id || '');
  if (!id) return null;
  const sub = String(ev.subtype || '');
  const mutating = isMutatingTool(Object.keys(ev.tool_call || {})[0]);
  if (sub === 'completed' || sub === 'error') return { id, phase: 'end' };
  if (sub === 'started') return { id, phase: 'start', mutating };
  return null;
}

export function opencodeToolPhase(ev) {
  if (!ev || (ev.type !== 'tool_use' && ev.type !== 'tool')) return null;
  const part = ev.part || ev;
  const id = String(part.id || part.callID || part.callId || '');
  if (!id) return null;
  const status = String(part.state?.status || '');
  if (status === 'running') return { id, phase: 'start', mutating: isMutatingTool(part.tool) };
  if (status === 'completed' || status === 'error') return { id, phase: 'end' };
  return null;
}

export function codexToolPhase(data) {
  const type = String(data?.type || '');
  if (type !== 'item.started' && type !== 'item.completed') return null;
  const item = data.item || {};
  if (String(item.type || '') === 'agent_message') return null;
  const id = String(item.id || item.call_id || '');
  if (!id) return null;
  return { id, phase: type === 'item.started' ? 'start' : 'end', mutating: isMutatingTool(item.type) };
}

/** Herramientas abiertas. `wait` sigue hasta que cierran, o hasta el tope. */
export function createToolGate() {
  const open = new Set();
  let waiting = [];
  const release = () => {
    if (open.size) return;
    const list = waiting;
    waiting = [];
    for (const done of list) done();
  };
  return {
    observe(phase) {
      if (!phase?.id) return;
      if (phase.phase === 'start' && phase.mutating !== false) open.add(phase.id);
      else if (phase.phase === 'end') open.delete(phase.id);
      release();
    },
    busy() {
      return open.size > 0;
    },
    wait(ms = TOOL_WAIT_MS) {
      if (!open.size) return Promise.resolve('idle');
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting = waiting.filter((done) => done !== finish);
          resolve('timeout');
        }, ms);
        const finish = () => {
          clearTimeout(timer);
          resolve('idle');
        };
        waiting.push(finish);
      });
    },
  };
}

export function holdForCurrentTool(gate, timeoutMs = TOOL_WAIT_MS) {
  return gate.wait(timeoutMs);
}