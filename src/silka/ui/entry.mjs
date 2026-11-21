import { clip, shortId } from '../format.mjs';
import { segLine } from './paint.mjs';
import { agentColor, palette } from './theme.mjs';

/** Filas del selector de modelos que caben en la caja (sin contar las 2 de cabecera). */
export const PICKER_ROWS = 7;

function hintLine(h, Text, text, width, key = 'hint') {
  return segLine(h, Text, [{ text: clip(text, width), color: palette.muted }], key);
}

function promptLine(h, Text, text, width, color = palette.edge, key = 'in') {
  return segLine(h, Text, [{ text: '› ', color, bold: true }, { text: clip(`${text}`, width - 3), color: palette.ink }, { text: '█', color: palette.edge }], key);
}

/** Ventana del selector alrededor del elegido. */
export function pickerWindow(items, index, rows = PICKER_ROWS) {
  const at = Math.min(Math.max(0, index), Math.max(0, items.length - 1));
  const start = Math.min(Math.max(0, at - Math.floor(rows / 2)), Math.max(0, items.length - rows));
  return { start, at, items: items.slice(start, start + rows) };
}

export function renderComposer(h, Box, Text, {
  mode, draft, field, wizard, agents, columns, selected, query, picker,
}) {
  const width = Math.max(10, columns - 4);
  if (mode === 'help') return hintLine(h, Text, 'Ayuda abierta · esc cierra', width);
  if (mode === 'confirm') {
    return h(
      Box,
      { flexDirection: 'column' },
      segLine(h, Text, [{ text: '¿Cancelar ', color: palette.bad, bold: true }, { text: selected ? shortId(selected.sessionId) : '', color: palette.ink }, { text: '?', color: palette.bad, bold: true }], 'q'),
      hintLine(h, Text, 's confirma · cualquier otra tecla vuelve', width),
    );
  }
  if (mode === 'steer' || mode === 'note') {
    const label = mode === 'steer' ? 'Redirigir' : 'Nota para el manager (Claude la verá al revisar)';
    return h(Box, { flexDirection: 'column' }, hintLine(h, Text, `${label} · enter guarda · esc cancela`, width), promptLine(h, Text, field, width));
  }
  if (mode === 'search') {
    return h(Box, { flexDirection: 'column' }, hintLine(h, Text, 'Buscar en el chat · enter o esc cierra', width), promptLine(h, Text, `/${query}`, width));
  }
  if (wizard?.step === 'agent') {
    return h(
      Box,
      { flexDirection: 'column' },
      hintLine(h, Text, 'Nueva sesión · ¿quién trabaja? · ↑↓ elige · enter sigue · esc cancela', width),
      ...agents.map((agent, index) => {
        const on = index === wizard.index;
        return segLine(h, Text, [
          { text: on ? '▸ ' : '  ', color: palette.edge },
          { text: agent, color: agentColor(agent), bold: on, dim: !on },
        ], agent);
      }),
    );
  }
  if (wizard?.step === 'model') {
    const items = picker?.items || [];
    const view = pickerWindow(items, wizard.mIndex || 0);
    const status = picker?.loading ? '  cargando catálogo…' : picker?.error ? `  ! ${picker.error}` : `  ${items.length} de ${picker?.total ?? items.length}`;
    const rows = view.items.map((m, i) => {
      const on = view.start + i === view.at;
      const tags = [
        m.isDefault ? { text: ' ★ por defecto', color: palette.run } : null,
        !m.isDefault && m.isRecent ? { text: ' · reciente', color: palette.muted } : null,
        m.free ? { text: ' · gratis', color: palette.ok } : null,
        m.available === false ? { text: ' ✗ no disponible con tu cuenta', color: palette.bad } : null,
      ].filter(Boolean);
      return segLine(h, Text, [
        { text: on ? '▸ ' : '  ', color: palette.edge },
        { text: clip(m.id, 40).padEnd(Math.min(40, Math.max(28, m.id.length + 2))), color: m.available === false ? palette.rule : on ? palette.ink : palette.steelDim, bold: on },
        { text: m.name && m.name !== m.id ? clip(m.name, 28) : '', color: on ? palette.steelDim : palette.rule },
        ...tags,
      ], m.id);
    });
    const typed = String(wizard.model || '').trim();
    const extra = wizard.confirmTyped
      ? [segLine(h, Text, [{ text: `'${typed}' no está en el catálogo. enter otra vez para usarlo igual.`, color: palette.run }], 'warn')]
      : !items.length && typed
        ? [hintLine(h, Text, `  Sin coincidencias. enter usa '${typed}' tal cual.`, width, 'none')]
        : [];
    return h(
      Box,
      { flexDirection: 'column' },
      segLine(h, Text, [
        { text: 'Modelo para ', color: palette.muted },
        { text: wizard.agent, color: agentColor(wizard.agent), bold: true },
        { text: status, color: picker?.error ? palette.bad : palette.muted },
        { text: items.length ? `  ·  ${Math.min((wizard.mIndex || 0) + 1, items.length)}/${items.length}` : '', color: palette.steelDim },
      ], 'h'),
      promptLine(h, Text, wizard.model || '', width, agentColor(wizard.agent)),
      ...extra,
      ...rows,
      hintLine(h, Text, 'escribe para buscar · ↑↓ · enter elige · ctrl+d lo deja por defecto · esc vuelve', width, 'pk'),
    );
  }
  if (wizard?.step === 'prompt') {
    const promptLines = (wizard.prompt || '').split('\n');
    const shown = promptLines.slice(-3);
    return h(
      Box,
      { flexDirection: 'column' },
      segLine(h, Text, [
        { text: 'Encargo para ', color: palette.muted },
        { text: wizard.agent, color: agentColor(wizard.agent), bold: true },
        { text: wizard.chosen ? `  ·  ${wizard.chosen}` : '  ·  modelo por defecto', color: palette.steelDim },
        { text: '  ·  enter nueva línea · ctrl+s lanza · esc vuelve', color: palette.rule },
      ], 'h'),
      ...shown.map((line, index) => (index === shown.length - 1
        ? promptLine(h, Text, line, width, agentColor(wizard.agent), `p${index}`)
        : segLine(h, Text, [{ text: '  ' }, { text: clip(line, width - 2), color: palette.ink }], `p${index}`))),
    );
  }
  const to = selected ? selected.agentId : '';
  return h(
    Box,
    { flexDirection: 'column' },
    promptLine(h, Text, draft || '', width, to ? agentColor(to) : palette.edge),
    hintLine(h, Text, draft
      ? 'enter encola · ctrl+enter envía ya (interrumpe) · alt+enter igual · esc borra'
      : (to ? `escríbele a ${to}  ·  ↑ mensajes en cola` : 'n pone a alguien a trabajar'), width),
  );
}
