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

export function interruptPath(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Pid de shim inválido.');
  return path.join(interruptDir(), String(id));
}

export function writeInterrupt(order) {
  const file = interruptPath(order?.pid);
  const body = {
    pid: Number(order.pid),
    sessionId: String(order.sessionId || ''),
    messageId: String(order.messageId || ''),
    text: String(order.text || ''),
    author: originLabel(order.author || 'tú'),
    at: new Date().toISOString(),
  };
  writeAtomic(file, `${JSON.stringify(body)}\n`);
  return body;
}

export function readInterrupt(pid) {
  try {
    const parsed = JSON.parse(fs.readFileSync(interruptPath(pid), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearInterrupt(pid) {
  try { fs.rmSync(interruptPath(pid), { force: true }); } catch { /* ya no está */ }
}

/** Pid del shim de la sesión, el que está en `.silka/tasks.json`. */
export function shimPidForSession(session, tasks) {
  if (!session?.sessionId) return 0;
  const list = Array.isArray(tasks)
    ? tasks
    : (session.workspace ? readStore(session.workspace).tasks : []);
  const running = list.filter((task) => task?.status === 'running' && Number(task.pid) > 0);
  const linked = running.find((task) => task.sessionId && task.sessionId === session.sessionId);
  if (linked) return Number(linked.pid);
  const same = running.filter((task) => {
    const workspace = task.workspace || session.workspace;
    return samePath(workspace, session.workspace)
      && originLabel(task.agent) === originLabel(session.agentId);
  });
  if (!same.length) return 0;
  if (same.length === 1) return Number(same[0].pid);
  const target = Date.parse(session.createdAt);
  same.sort((a, b) => {
    const da = Math.abs(Date.parse(a.startedAt) - target);
    const db = Math.abs(Date.parse(b.startedAt) - target);
    return (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
  });
  return Number(same[0].pid);
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
