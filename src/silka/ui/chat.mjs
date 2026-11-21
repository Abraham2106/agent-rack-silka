import { clip, formatDuration, isBusy } from '../format.mjs';
import { activityLine, renderSplash, segLine } from './paint.mjs';
import { logoRows, palette } from './theme.mjs';

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
      rows.push({ key: event.id, kind: 'message', text, author: event.author, role: event.kind, body: String(event.text || '').replace(/\s+/g, ' ').trim(), now: Boolean(mark) });
    }
  }
  // Ritmo: aire antes de cada mensaje (los turnos se separan) y las herramientas pegadas
  // a su mensaje. Una racha larga de herramientas se pliega: primeras 2, "… N más", últimas 3.
  const shaped = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === 'message' && shaped.length) shaped.push({ key: `gap-${row.key}`, kind: 'gap', text: '' });
    if (row.kind !== 'tool') { shaped.push(row); continue; }
    let j = i;
    while (j < rows.length && rows[j].kind === 'tool') j += 1;
    const run = rows.slice(i, j);
    if (!needle && run.length > 7) {
      shaped.push(...run.slice(0, 2));
      shaped.push({ key: `fold-${run[2].key}`, kind: 'fold', text: `(… ${run.length - 5} herramientas más)` });
      shaped.push(...run.slice(-3));
    } else shaped.push(...run);
    i = j - 1;
  }
  rows.length = 0;
  rows.push(...shaped);
  rows.push({ key: 'queue-gap', kind: 'gap', text: '' });
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

/** Parte un texto en líneas de `width` columnas respetando palabras. */
export function wrapText(text, width) {
  const w = Math.max(8, width);
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += ` ${word}`;
      else { out.push(line); line = word; }
      while (line.length > w) { out.push(line.slice(0, w)); line = line.slice(w); }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/**
 * Filas visuales del chat: mensajes partidos en líneas (como Antigravity, nada de "…"),
 * detalle de herramientas expandidas. Mismo resultado en el TUI y al navegar con el cursor.
 */
export function flattenChatRows(rows, expanded, width = 100) {
  const flat = [];
  for (const row of rows) {
    if (row.kind === 'message') {
      const user = row.role === 'user';
      let lines = wrapText(row.body ?? row.text, width - 2);
      // Un encargo largo no tapa la conversación: 6 líneas y el resto plegado.
      if (user && lines.length > 6 && !expanded?.has?.(row.key)) {
        lines = [...lines.slice(0, 5), `(… ${lines.length - 5} líneas más)`];
      }
      lines.forEach((line, i) => flat.push({ ...row, key: i ? `${row.key}-w${i}` : row.key, line, first: i === 0, user }));
      continue;
    }
    flat.push(row);
    if (row.kind !== 'tool' || !expanded?.has?.(row.toolId)) continue;
    const parts = String(row.detail || 'sin detalle').split(/\n/).slice(0, 8);
    for (const [index, part] of parts.entries()) {
      flat.push({ key: `${row.key}-d${index}`, kind: 'detail', text: part, toolId: row.toolId });
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

/** Segmentos de una fila, con el lenguaje de Antigravity. */
function rowSegments(row, { active, selectedQueue, width }) {
  if (row.kind === 'message') {
    if (row.user) {
      // "> lo que pidió el usuario" en azul grisáceo; si lo mandó Claude, se dice.
      const who = row.author && row.author !== 'tú' ? `(${row.author}) ` : '';
      return [
        { text: row.first ? '> ' : '  ', color: palette.prompt, bold: true },
        { text: row.first ? who : '', color: palette.muted },
        { text: row.line, color: palette.prompt, bold: true },
        { text: row.first && row.now ? '  ⚡ enviado ya' : '', color: palette.tool },
      ];
    }
    return [{ text: '  ' }, { text: row.line, color: palette.ink }];
  }
  if (row.kind === 'gap') return [{ text: ' ' }];
  if (row.kind === 'fold') return [{ text: row.text, color: palette.muted }];
  if (row.kind === 'detail') return [{ text: `    ${clip(String(row.text).trim(), width - 4)}`, color: palette.muted }];
  if (row.kind === 'tool') {
    // ● Herramienta(argumentos…)  — viñeta oliva, nombre amarillo, argumentos en gris.
    const raw = String(row.text);
    const tone = raw.startsWith('◌') ? palette.run : raw.startsWith('✗') ? palette.bad : palette.dot;
    const rest = raw.replace(/^[◌✗→]\s*/, '');
    const shell = rest.startsWith('$');
    const clean = rest.replace(/^\$\s*/, '');
    const [first, ...more] = clean.split(/\s+/);
    const name = shell ? 'Shell' : (first ? first[0].toUpperCase() + first.slice(1) : 'Tool');
    const args = shell ? clean : more.join(' ');
    const room = Math.max(8, width - name.length - 6);
    return [
      { text: '● ', color: tone },
      { text: name, color: palette.tool, bold: true },
      { text: args ? `(${clip(args, room)})` : '', color: palette.args },
      { text: active ? '  enter expande' : '', color: palette.muted },
    ];
  }
  if (row.kind === 'rule') {
    if (row.key === 'queue-rule') return [{ text: 'en cola', color: palette.muted }];
    return [{ text: clip(row.text, width), color: palette.tool }];
  }
  if (row.kind === 'queue') {
    if (row.text === 'vacía') return [{ text: '  nada esperando', color: palette.rule }];
    const failed = /✗ no entregado/.test(row.text);
    return [{ text: selectedQueue ? '▸ ' : '  ', color: palette.prompt }, { text: clip(row.text, width - 2), color: failed ? palette.bad : palette.muted }];
  }
  return [{ text: clip(row.text, width), color: palette.ink }];
}

/** Cabecera de la conversación (scrollea con ella): logo + "Silka 0.1.0" + agente·modelo + carpeta. */
export function bannerRows(session, model, width) {
  const logo = width >= 60 ? logoRows(20) : width >= 40 ? logoRows(14) : [];
  const info = [
    [{ text: 'Silka 0.1.0', color: palette.title, bold: true }],
    [{ text: `${session.agentId} · ${model || 'modelo por defecto'}`, color: palette.muted }],
    [{ text: shortWorkspace(session.workspace), color: palette.muted }],
  ];
  const rows = [];
  const n = Math.max(logo.length, info.length);
  for (let i = 0; i < n; i += 1) {
    const text = info[i - Math.max(0, Math.floor((logo.length - info.length) / 2))] || [];
    rows.push({ key: `art-${i}`, kind: 'art', segs: [...(logo[i] || [{ text: ' '.repeat(logo[0]?.length || 0) }]), { text: '    ' }, ...text] });
  }
  rows.push({ key: 'art-gap', kind: 'gap', text: '' });
  rows.push({ key: 'art-rule', kind: 'art', segs: [{ text: '─'.repeat(Math.max(10, Math.floor(width * 0.6))), color: palette.rule }] });
  return rows;
}

function shortWorkspace(dir) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const text = String(dir || '');
  return home && text.toLowerCase().startsWith(home.toLowerCase()) ? `~${text.slice(home.length).replace(/\\/g, '/')}` : text;
}

export function renderChat(h, Box, Text, {
  session, meta, origins, models, events, queued, width, height, query, expanded, focus, pinned, selectedQueueId, frame = 0,
}) {
  const inner = Math.max(8, width - 3);
  if (!session) {
    return renderSplash(h, Box, Text, { width, height, hint: 'n  pon a alguien a trabajar' });
  }
  const info = meta[session.sessionId] || {};
  const model = info.model || models[session.agentId] || '';
  const busy = isBusy(session.status);
  const liveH = busy ? 2 : 0;
  const rows = [...bannerRows(session, model, inner), { key: 'b-gap', kind: 'gap', text: '' }, ...flattenChatRows(buildChatRows(events, queued, query), expanded, inner)];
  const view = visibleChatRows(rows, { height: Math.max(1, height - liveH), focus: focus + (pinned ? 0 : bannerRows(session, model, inner).length + 1), pinned });
  const lastTool = [...(events || [])].reverse().find((e) => e.kind === 'tool');
  const body = view.rows.map((row, index) => segLine(h, Text, row.kind === 'art' ? row.segs : rowSegments(row, {
    active: view.start + index === view.cursor && !pinned,
    selectedQueue: row.key === selectedQueueId,
    width: inner,
  }), row.key));
  return h(
    Box,
    { width, height, flexDirection: 'column', paddingLeft: 1, paddingRight: 1, overflow: 'hidden' },
    ...body,
    h(Box, { key: 'fill', flexGrow: 1 }),
    busy ? h(Text, { key: 'live-gap' }, ' ') : null,
    busy ? segLine(h, Text, activityLine({
      frame,
      agent: session.agentId,
      elapsed: formatDuration(session),
      tool: lastTool ? clip(String(lastTool.tool?.target || lastTool.text || ''), 40) : '',
    }), 'live') : null,
  );
}
