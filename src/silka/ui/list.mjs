import { clip, formatDuration, originLabel, promptPreview, shortId, statusIcon } from '../format.mjs';
import { segLine } from './paint.mjs';
import { agentColor, c, palette, statusTone } from './theme.mjs';

/** Ventana de la lista: solo las filas que caben alrededor de la selección. */
export function sessionWindow(ordered, selectedId, room) {
  const visibleCount = Math.max(1, Math.floor(room / 3));
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
  const room = Math.max(1, height - 2);
  const windowed = sessionWindow(ordered, selectedId, room);
  const rows = windowed.rows.map(({ session, depth }) => {
    const active = selectedId === session.sessionId;
    const info = meta[session.sessionId] || {};
    const model = info.model || models[session.agentId] || '';
    const origin = originLabel(origins[session.sessionId]);
    const tone = agentColor(session.agentId);
    const indent = depth ? `${'  '.repeat(Math.min(depth, 3))}↳ ` : '';
    // Marcas con significado, no letras: ⏳ cola · ✉ nota · ⚠ conflicto.
    const marks = [
      queues[session.sessionId]?.length ? { text: ' ⏳', color: palette.run } : null,
      noted.has(session.sessionId) ? { text: ' ✉', color: palette.edge } : null,
      hotIds.has(session.sessionId) ? { text: ' ⚠', color: palette.bad } : null,
      { text: ' ' },
    ].filter(Boolean);
    const bar = active ? { text: ' ▌', color: tone } : { text: '  ' };
    const head = [
      bar,
      { text: indent, color: palette.rule },
      { text: `${statusIcon(session.status)} `, color: statusTone(session.status) },
      { text: session.agentId, color: tone, bold: active, dim: !active },
      ...marks,
      { text: clip(`  ${formatDuration(session)} · ${origin}`, Math.max(0, inner - session.agentId.length - indent.length - 4)), color: palette.muted },
    ];
    const preview = info.steeredFrom
      ? `↳ ${shortId(info.steeredFrom)} · ${promptPreview(info.prompt || session.summary || '') || 'sigue el trabajo'}`
      : [model, promptPreview(info.prompt || session.summary || '')].filter(Boolean).join(' · ') || 'sin prompt';
    const sub = [bar, { text: `  ${clip(preview, inner - 2)}`, color: active ? palette.steelDim : palette.rule }];
    return h(
      Box,
      { key: session.sessionId, flexDirection: 'column' },
      segLine(h, Text, head, 'h'),
      segLine(h, Text, sub, 's'),
      h(Text, { key: 'air' }, ' '),
    );
  });
  const title = ordered.length > windowed.visibleCount
    ? `taller  ${windowed.start + 1}–${windowed.start + windowed.rows.length} de ${ordered.length}`
    : 'taller';
  // Sin caja: una línea vertical fina a la derecha separa la lista del chat.
  return h(
    Box,
    {
      width, height, flexDirection: 'column', overflow: 'hidden',
      borderStyle: 'single', borderColor: c(palette.rule), borderTop: false, borderBottom: false, borderLeft: false,
    },
    segLine(h, Text, [{ text: `  ${title}`, color: palette.muted, bold: true }], 'title'),
    h(Text, { key: 'tgap' }, ' '),
    ordered.length
      ? rows
      : segLine(h, Text, [{ text: '  Nada en el taller todavía.', color: palette.steelDim }], 'empty'),
  );
}
