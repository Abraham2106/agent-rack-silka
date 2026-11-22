import { groupActivity } from '../format.mjs';

function cleanInline(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function continuesFragment(prev, next) {
  const p = String(prev).trim();
  const n = String(next).trim();
  if (!p || !n) return false;
  if (/[.!?…\s]$/.test(p)) return false;
  const tail = p.match(/[\p{L}\p{N}]+$/u)?.[0] ?? '';
  return tail.length > 0 && tail.length <= 3 && /^[\p{L}\p{N}]/u.test(n);
}

/** Une ráfagas ✎ del stderr del shim (deltas de Cursor). */
export function mergePencilParts(parts) {
  const out = [];
  let buf = '';
  let last = '';
  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    last = '';
    if (text) out.push(text);
  };
  for (const part of parts) {
    const piece = String(part ?? '').trim();
    if (!piece) continue;
    if (!buf) buf = piece;
    else if (continuesFragment(last, piece)) buf += piece;
    else {
      flush();
      buf = piece;
    }
    last = piece;
  }
  flush();
  return out;
}

/** Fin de turno en el buffer del hub (shim → claude_stream_json). */
export function isTurnResultEvent(event) {
  if (!event || event.type !== 'text') return false;
  const kind = String(event.metadata?.type || '');
  if (kind === 'result' || kind === 'summary') return true;
  const raw = String(event.content || '').trim();
  if (!raw.startsWith('{')) return false;
  try {
    const data = JSON.parse(raw);
    return data?.type === 'result' || data?.type === 'summary';
  } catch {
    return false;
  }
}

/** Eventos del turno `turnCount` (el más reciente si ya terminó o sigue en curso). */
export function eventsForTurn(events, turnCount) {
  const list = Array.isArray(events) ? events : [];
  const turn = Math.max(1, Number(turnCount) || 1);
  if (turn <= 1) return list;
  const ends = [];
  for (let i = 0; i < list.length; i++) {
    if (isTurnResultEvent(list[i])) ends.push(i);
  }
  if (ends.length >= turn - 1) return list.slice(ends[turn - 2] + 1);
  if (ends.length > 0) return list.slice(ends[ends.length - 1] + 1);
  return list;
}

function pencilLinesFromStatus(content) {
  return String(content ?? '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('✎ '));
}

function textFromAgentEvents(events) {
  const textBlocks = [];
  const pencils = [];
  for (const event of events) {
    if (event?.type === 'text') {
      const kind = String(event.metadata?.type || '');
      const body = cleanInline(event.content);
      if (!body) continue;
      if (kind === 'result' || kind === 'summary') {
        textBlocks.push(body);
        continue;
      }
      if (body.startsWith('{') || body.startsWith('[')) {
        try {
          const data = JSON.parse(body);
          if (data?.type === 'result' || data?.type === 'summary') {
            const msg = cleanInline(data.result ?? data.text ?? '');
            if (msg) textBlocks.push(msg);
            continue;
          }
        } catch { /* no es JSON del protocolo */ }
      }
      if (!/^→\s|^✗\s|^Tool Call:/i.test(body)) textBlocks.push(body);
    } else if (event?.type === 'status') {
      for (const line of pencilLinesFromStatus(event.content)) {
        const part = line.slice(2).trim();
        if (part) pencils.push(part);
      }
    }
  }
  const fromPencil = mergePencilParts(pencils);
  const merged = groupActivity([
    ...fromPencil,
    ...textBlocks.filter((b) => !fromPencil.includes(b)),
  ].map((b) => `✎ ${b}`)).map((line) => line.slice(2).trim());
  return merged.filter(Boolean).join('\n\n').trim();
}

/**
 * @param {object[]} events — página completa o tail de agent_session_logs
 * @param {number} [turnCount]
 */
export function lastAgentMessageFromEvents(events, turnCount = 1) {
  const turnEvents = eventsForTurn(events, turnCount);
  const fromResult = [...turnEvents].reverse().find((ev) => isTurnResultEvent(ev));
  if (fromResult) {
    const direct = cleanInline(fromResult.content);
    if (direct) return { lastMessage: direct, noText: false };
  }
  const merged = textFromAgentEvents(turnEvents);
  if (merged) return { lastMessage: merged, noText: false };
  return { lastMessage: '', noText: true };
}

/** Añade lastMessage, noText y turn a la tarjeta de sesión (wait / waitAll). */
export function enrichWaitCard(card, events) {
  const turn = Math.max(1, Number(card?.turnCount) || 1);
  const { lastMessage, noText } = lastAgentMessageFromEvents(events, turn);
  return {
    ...card,
    turn,
    lastMessage,
    noText,
  };
}