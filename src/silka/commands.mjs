import path from 'node:path';
import { formatDuration, isBusy, originLabel, pad, promptPreview, shortId } from './format.mjs';
import { readMeta, readPrompts, rememberSession } from './hub.mjs';
import { clearInterrupt, turnForSession, writeInterrupt } from './interrupt.mjs';
import { appendNote } from './notes.mjs';
import { originLabel as agentName, readOrigins } from './origin.mjs';
import { clearQueue, enqueueMessage, listQueue, setQueuedNow } from './queue.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model' || arg === '--workspace') {
      const value = argv[i + 1];
      if (!value) throw new Error(`Falta el valor de ${arg}`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--model=')) {
      flags.model = arg.slice('--model='.length);
    } else if (arg.startsWith('--workspace=')) {
      flags.workspace = arg.slice('--workspace='.length);
    } else if (arg === '--now') {
      flags.now = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export function matchSession(sessions, id) {
  const exact = sessions.find((session) => session.sessionId === id);
  if (exact) return exact;
  const matches = sessions.filter((session) => session.sessionId.startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No hay sesión '${id}'.`);
  throw new Error(`El id '${id}' coincide con ${matches.length} sesiones. Usa un id más largo.`);
}

export async function listSessionsCommand(client, port) {
  const sessions = await client.listSessions();
  const prompts = readPrompts(port);
  const origins = readOrigins();
  if (!Array.isArray(sessions) || sessions.length === 0) {
    console.log('No hay sesiones.');
    return;
  }
  console.log(`${pad('id', 10)}${pad('agente', 12)}${pad('estado', 12)}${pad('tiempo', 10)}${pad('origen', 16)}prompt`);
  for (const session of sessions) {
    const prompt = promptPreview(prompts[session.sessionId] || session.summary || '');
    console.log(
      `${pad(shortId(session.sessionId), 10)}${pad(session.agentId, 12)}${pad(session.status, 12)}${pad(formatDuration(session), 10)}${pad(originLabel(origins[session.sessionId]), 16)}${prompt}`,
    );
  }
}

export async function runSession(client, status, argv) {
  const { positional, flags } = parseArgs(argv);
  const agent = positional[0];
  const prompt = positional.slice(1).join(' ').trim();
  if (!agent || !prompt) {
    throw new Error('Uso: silka run <agente> "<prompt>" [--model m] [--workspace dir]');
  }
  if (!status.agents.includes(agent)) {
    const known = status.agents.length ? status.agents.join(', ') : '(ninguno)';
    throw new Error(`Agente '${agent}' no está en la config. Disponibles: ${known}`);
  }
  const workspace = path.resolve(flags.workspace || process.cwd());
  const created = await client.createSession(agent, prompt, workspace, flags.model || undefined);
  const sessionId = created?.sessionId;
  if (!sessionId) throw new Error('El hub no devolvió un sessionId.');
  rememberSession(status.port, sessionId, { prompt, model: flags.model || '' });
  console.log(sessionId);
}

export function buildSteerPrompt(original, instruction) {
  const base = String(original ?? '').trim();
  const next = String(instruction ?? '').trim();
  return [
    base,
    `INSTRUCCIÓN NUEVA DEL USUARIO (tiene prioridad): ${next}`,
    'Continúa desde el estado actual de los archivos; no rehagas lo que ya está bien.',
  ].filter((part, index) => index !== 0 || part).join('\n\n');
}

async function waitUntilSettled(client, sessionId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const list = await client.listSessions();
    const current = (Array.isArray(list) ? list : []).find((session) => session.sessionId === sessionId);
    if (!current || !isBusy(current.status)) return;
    await sleep(300);
  }
  throw new Error(`La sesión ${shortId(sessionId)} sigue en curso. No abrí otra.`);
}

export async function steerSession(client, _status, argv) {
  return sendMessage(client, argv, { now: true });
}

export async function redirectSession(client, status, session, instruction) {
  const text = String(instruction ?? '').trim();
  if (!text) throw new Error('La instrucción está vacía.');
  await client.cancelSession(session.sessionId);
  await waitUntilSettled(client, session.sessionId);
  const meta = readMeta(status.port)[session.sessionId] || {};
  const model = meta.model || status.config?.agents?.[session.agentId]?.model || undefined;
  const prompt = buildSteerPrompt(meta.prompt || '', text);
  const workspace = session.workspace || process.cwd();
  const created = await client.createSession(session.agentId, prompt, workspace, model);
  const sessionId = created?.sessionId;
  if (!sessionId) throw new Error('El hub no devolvió un sessionId.');
  rememberSession(status.port, sessionId, {
    prompt,
    model: model || '',
    steeredFrom: session.sessionId,
  });
  return sessionId;
}

export async function noteSession(client, argv) {
  const { positional } = parseArgs(argv);
  const id = positional[0];
  const text = positional.slice(1).join(' ').trim();
  if (!id || !text) throw new Error('Uso: silka note <id> "<texto>"');
  const sessions = await client.listSessions();
  const session = matchSession(Array.isArray(sessions) ? sessions : [], id);
  const note = appendNote({ sessionId: session.sessionId, text });
  console.log(note.id);
}

function rememberInsertion(session, text) {
  const body = String(text ?? '').trim();
  if (!body || !session?.sessionId) return null;
  const agent = agentName(session.agentId || 'agente');
  try {
    return appendNote({
      sessionId: session.sessionId,
      workspace: session.workspace || '',
      kind: 'insertion',
      text: `tú → ${agent} ${shortId(session.sessionId)}: ${body}`,
    });
  } catch {
    return null;
  }
}

/**
 * Encola, y con `now` mientras el turno sigue escribe la orden de interrupción
 * al pid del shim. Si el turno ya terminó, queda como un turno normal.
 */
export function sendToSession(session, { text, author = 'tú', now = false, messageId } = {}) {
  if (!session?.sessionId) throw new Error('No hay sesión.');
  if (session.status === 'cancelled') {
    throw new Error(`La sesión ${shortId(session.sessionId)} fue cancelada.`);
  }
  const busy = isBusy(session.status);
  const immediate = Boolean(now) && busy;
  let item;
  if (messageId) {
    item = setQueuedNow(session.sessionId, messageId, immediate);
    if (!item) throw new Error('Ese mensaje ya no está en la cola.');
  } else {
    item = enqueueMessage(session.sessionId, { author, text, now: immediate });
  }
  if (!messageId && agentName(author) === 'tú') rememberInsertion(session, item.text);
  let interrupted = false;
  if (immediate) {
    const turnId = turnForSession(session);
    if (turnId) {
      clearInterrupt(turnId);
      writeInterrupt({
        turnId,
        sessionId: session.sessionId,
        messageId: item.id,
        text: item.text,
        author: item.author,
      });
      interrupted = true;
    }
  }
  return { item, interrupted, immediate };
}

export async function sendMessage(client, argv, defaults = {}) {
  const { positional, flags } = parseArgs(argv);
  const id = positional[0];
  const message = positional.slice(1).join(' ').trim();
  const now = Boolean(defaults.now || flags.now);
  if (!id || !message) {
    throw new Error(defaults.now && !flags.now
      ? 'Uso: silka steer <id> "<mensaje>"'
      : 'Uso: silka send <id> "<mensaje>" [--now]');
  }
  const sessions = await client.listSessions();
  const session = matchSession(Array.isArray(sessions) ? sessions : [], id);
  const result = sendToSession(session, { text: message, author: defaults.author || 'tú', now });
  const where = shortId(session.sessionId);
  if (result.interrupted) console.log(`enviado ya ${result.item.id} ${where}`);
  else if (now) console.log(`enviado ${result.item.id} ${where}`);
  else console.log(`en cola ${result.item.id} ${where}`);
  return result;
}

export async function queueCommand(client, argv) {
  const clear = argv.includes('--clear');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const id = positional[0];
  if (!id) throw new Error('Uso: silka queue <id> [--clear]');
  const sessions = await client.listSessions();
  const session = matchSession(Array.isArray(sessions) ? sessions : [], id);
  if (clear) {
    const count = clearQueue(session.sessionId);
    console.log(`cola vacía ${shortId(session.sessionId)} (${count})`);
    return;
  }
  const items = listQueue(session.sessionId);
  if (!items.length) {
    console.log('Cola vacía.');
    return;
  }
  for (const item of items) {
    console.log(`${String(item.id).slice(0, 8)}  ${item.author}  ${item.status}  ${item.text}`);
  }
}
