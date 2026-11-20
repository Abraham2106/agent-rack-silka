import path from 'node:path';
import { formatDuration, isBusy, originLabel, pad, promptPreview, shortId } from './format.mjs';
import { readMeta, readPrompts, rememberSession } from './hub.mjs';
import { appendNote } from './notes.mjs';
import { readOrigins } from './origin.mjs';

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
}

export async function steerSession(client, status, argv) {
  const { positional } = parseArgs(argv);
  const id = positional[0];
  const instruction = positional.slice(1).join(' ').trim();
  if (!id || !instruction) throw new Error('Uso: silka steer <id> "<instrucción>"');
  const sessions = await client.listSessions();
  const session = matchSession(Array.isArray(sessions) ? sessions : [], id);
  const createdId = await redirectSession(client, status, session, instruction);
  console.log(createdId);
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

function stillRunning(message) {
  return /is still (running|cancelling)|still running/i.test(message);
}

export async function sendMessage(client, argv) {
  const { positional } = parseArgs(argv);
  const id = positional[0];
  const message = positional.slice(1).join(' ').trim();
  if (!id || !message) throw new Error('Uso: silka send <id> "<mensaje>"');

  const deadline = Date.now() + 15 * 60 * 1000;
  let announced = false;
  while (Date.now() < deadline) {
    const sessions = await client.listSessions();
    const session = matchSession(Array.isArray(sessions) ? sessions : [], id);
    if (session.status === 'cancelled') {
      throw new Error(`La sesión ${shortId(session.sessionId)} fue cancelada.`);
    }
    if (isBusy(session.status)) {
      if (!announced) {
        console.error('en cola: esperando a que termine el turno…');
        announced = true;
      }
      await sleep(1000);
      continue;
    }
    try {
      await client.sendInput(session.sessionId, message);
      console.log(`enviado ${shortId(session.sessionId)}`);
      return;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (stillRunning(detail)) {
        if (!announced) {
          console.error('en cola: esperando a que termine el turno…');
          announced = true;
        }
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Tiempo de espera agotado antes de poder enviar.');
}
