import { clip, formatDuration, originLabel, shortId, statusColor, statusIcon } from '../format.mjs';

export function interruptCount(events) {
  return (events || []).filter((event) => event.kind === 'interrupt').length;
}

function sentNow(event) {
  return Boolean(event?.now) || String(event?.text || '').includes('tiene prioridad sobre instrucciones anteriores');
}

export function agentPhase(status, events) {
  if (status === 'running' || status === 'cancelling') {
    const last = [...(events || [])].reverse().find((event) => event.kind === 'tool' || event.kind === 'agent');
    if (last?.kind === 'tool') return 'usando una herramienta';
    return 'pensando';
  }
  if (status === 'failed' || status === 'cancelled') return 'terminado';
  return 'esperando turno';
}

function toolText(event) {
  const tool = event.tool || {};
  const target = tool.target || event.text || tool.name || 'tool';
  if (tool.status === 'running') return `◌ ${target}`;
  if (String(tool.name) === 'error' || String(event.text).startsWith('✗')) return `✗ ${target}`;
  if (/^\$/.test(target) || String(tool.name) === '$') return `$ ${String(target).replace(/^\$\s*/, '')}`;
  return `→ ${target}`;
}

/** Filas del chat. La búsqueda deja fuera lo que no coincide. Una herramienta es una fila. */
export function buildChatRows(events, queued, query) {
  const needle = String(query || '').trim().toLowerCase();
  const rows = [];
  const keep = (text) => !needle || String(text || '').toLowerCase().includes(needle);
  for (const event of events || []) {
    if (event.kind === 'status') continue;
    if (event.kind === 'tool') {
      const text = toolText(event);
      const detail = event.tool?.detail || '';
      if (!keep(`${text}\n${detail}`)) continue;
      rows.push({ key: event.id, kind: 'tool', text, detail, toolId: event.id });
      continue;
    }
    if (event.kind === 'interrupt') {
      const text = `⚡ ${String(event.text || 'interrumpido por el usuario').replace(/\s+/g, ' ').trim()}`;
      if (!keep(text)) continue;
      rows.push({ key: event.id, kind: 'rule', text });
      continue;
    }
    if (event.kind === 'user' || event.kind === 'agent') {
      const mark = event.kind === 'user' && sentNow(event) ? '  ⚡' : '';
      const text = `${event.author || 'tú'}  ${String(event.text || '').replace(/\s+/g, ' ').trim()}${mark}`;
      if (!keep(text)) continue;
      rows.push({ key: event.id, kind: 'message', text, author: event.author });
    }
  }
  rows.push({ key: 'queue-rule', kind: 'rule', text: '── en cola ──' });
  const pending = queued || [];
  if (!pending.length) rows.push({ key: 'queue-empty', kind: 'queue', text: 'vacía' });
  for (const item of pending) {
    const mark = item.status === 'failed'
      ? `✗ no entregado: ${item.error || 'error'}`
      : (item.now ? '⚡' : '⏳');
    const text = `${item.author || 'tú'}  ${String(item.text || '').replace(/\s+/g, ' ').trim()}  ${mark}`;
    if (!keep(text)) continue;
    rows.push({ key: item.id, kind: 'queue', text });
  }
  return rows;
}

/** El detalle expandido entra en la lista antes de recortar, así no se pinta lo que no cabe. */
export function flattenChatRows(rows, expanded) {
  const flat = [];
  for (const row of rows) {
    flat.push(row);
    if (row.kind !== 'tool' || !expanded?.has?.(row.toolId)) continue;
    const parts = String(row.detail || 'sin detalle').split(/\n/).slice(0, 6);
    for (const [index, part] of parts.entries()) {
      flat.push({ key: `${row.key}-d${index}`, kind: 'detail', text: `    ${part}`, toolId: row.toolId });
    }
  }
  return flat;
}

/** Solo el tramo visible. `focus` es la fila activa; si está clavado al final, se ve el último mensaje. */
export function visibleChatRows(rows, { height, focus, pinned }) {
  const count = Math.max(1, height);
  const last = Math.max(0, rows.length - 1);
  const cursor = pinned ? last : Math.min(last, Math.max(0, focus));
  if (rows.length <= count) return { start: 0, cursor, rows };
  const start = Math.min(Math.max(0, cursor - count + 1), rows.length - count);
  return { start, cursor, rows: rows.slice(start, start + count) };
}

export function renderChat(h, Box, Text, {
  session, meta, origins, models, events, queued, width, height, query, expanded, focus, pinned, selectedQueueId,
}) {
  const inner = Math.max(8, width - 4);
  const info = session ? (meta[session.sessionId] || {}) : null;
  const model = session ? (info.model || models[session.agentId] || '') : '';
  const origin = session ? originLabel(origins[session.sessionId]) : '';
  const phase = session ? agentPhase(session.status, events) : '';
  const stops = session ? interruptCount(events) : 0;
  const header = session
    ? `${statusIcon(session.status)} ${session.agentId} · ${model || 'sin modelo'} · por ${origin} · ${formatDuration(session)}  ${phase}  · ${stops} interrupciones`
    : 'Chat';
  const headH = 2;
  const rows = flattenChatRows(buildChatRows(events, queued, query), expanded);
  const view = visibleChatRows(rows, { height: Math.max(1, height - 2 - headH), focus, pinned });
  const body = view.rows.map((row, index) => {
    const absolute = view.start + index;
    const active = absolute === view.cursor;
    const line = clip(row.kind === 'tool' ? `  ${row.text}` : row.text, inner);
    const color = row.kind === 'queue' ? 'yellow' : row.kind === 'rule' ? 'gray' : undefined;
    return h(Text, {
      key: row.key,
      color: active ? statusColor(session?.status) : color,
      inverse: row.key === selectedQueueId || (active && (row.kind === 'tool' || row.kind === 'detail')),
      dimColor: row.kind === 'rule' || row.kind === 'detail' || (row.kind === 'queue' && row.text === 'vacía'),
      wrap: 'truncate',
    }, line || ' ');
  });
  return h(
    Box,
    { width, height, flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1, overflow: 'hidden' },
    h(Text, { bold: true, wrap: 'truncate' }, clip(header, inner) || ' '),
    h(Text, { dimColor: true, wrap: 'truncate' }, clip(session ? `${shortId(session.sessionId)}  ${info?.prompt || session.summary || ''}` : 'Elige o crea una sesión.', inner) || ' '),
    body.length ? body : h(Text, { dimColor: true }, 'Sin conversación todavía.'),
  );
}
