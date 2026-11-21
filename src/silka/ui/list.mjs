import { clip, formatDuration, originLabel, promptPreview, shortId, statusColor, statusIcon } from '../format.mjs';

/** Ventana de la lista: solo las filas que caben alrededor de la selección. */
export function sessionWindow(ordered, selectedId, room) {
  const visibleCount = Math.max(1, Math.floor(room / 2));
  let selectedIndex = ordered.findIndex((item) => item.session.sessionId === selectedId);
  if (selectedIndex < 0) selectedIndex = 0;
  let start = 0;
  if (ordered.length > visibleCount) {
    start = Math.min(Math.max(0, selectedIndex - Math.floor(visibleCount / 2)), ordered.length - visibleCount);
  }
  return {
    start,
    visibleCount,
    rows: ordered.slice(start, start + visibleCount),
  };
}

export function renderSessionList(h, Box, Text, {
  ordered, selectedId, meta, models, origins, noted, hotIds, queues, width, height,
}) {
  const inner = Math.max(8, width - 4);
  const room = Math.max(1, height - 3);
  const windowed = sessionWindow(ordered, selectedId, room);
  const rows = windowed.rows.map(({ session, depth }) => {
    const active = selectedId === session.sessionId;
    const info = meta[session.sessionId] || {};
    const model = info.model || models[session.agentId] || '';
    const origin = originLabel(origins[session.sessionId]);
    const marks = `${queues[session.sessionId]?.length ? 'Q' : ''}${noted.has(session.sessionId) ? 'N' : ''}${hotIds.has(session.sessionId) ? '!' : ''}`;
    const indent = depth ? `${'  '.repeat(Math.min(depth, 4))}↳ ` : '';
    const head = clip(
      `${indent}${statusIcon(session.status)} ${shortId(session.sessionId)} ${session.agentId}${marks ? ` ${marks}` : ''} ${origin} ${formatDuration(session)}`,
      inner,
    );
    const sub = info.steeredFrom
      ? clip(`↳ ${shortId(info.steeredFrom)} · ${promptPreview(info.prompt || session.summary || '') || 'sigue el trabajo'}`, inner)
      : clip([model, promptPreview(info.prompt || session.summary || '')].filter(Boolean).join(' · ') || 'sin prompt', inner);
    return h(
      Box,
      { key: session.sessionId, flexDirection: 'column' },
      h(Text, { inverse: active, color: active ? undefined : statusColor(session.status), wrap: 'truncate' }, head),
      h(Text, { inverse: active, dimColor: !active, wrap: 'truncate' }, sub),
    );
  });
  const title = ordered.length > windowed.visibleCount
    ? `Sesiones ${windowed.start + 1}-${windowed.start + windowed.rows.length}/${ordered.length}`
    : 'Sesiones';
  return h(
    Box,
    { width, height, flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1, overflow: 'hidden' },
    h(Text, { bold: true }, title),
    ordered.length ? rows : h(Text, { dimColor: true }, 'Sin sesiones. n crea una.'),
  );
}
