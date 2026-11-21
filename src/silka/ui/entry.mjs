import { clip, shortId } from '../format.mjs';

export function renderComposer(h, Box, Text, {
  mode, draft, field, wizard, agents, columns, selected, query,
}) {
  if (mode === 'help') return h(Text, { wrap: 'truncate' }, 'Ayuda abierta. esc cierra.');
  if (mode === 'confirm') {
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { color: 'yellow' }, `Cancelar ${selected ? shortId(selected.sessionId) : ''}?`),
      h(Text, { dimColor: true, wrap: 'truncate' }, 's confirma · cualquier otra tecla vuelve'),
    );
  }
  if (mode === 'steer' || mode === 'note') {
    const label = mode === 'steer' ? 'Redirigir' : 'Nota para el manager';
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `${label} · enter guarda · esc cancela`),
      h(Text, { wrap: 'truncate' }, clip(`${field}█`, columns - 4)),
    );
  }
  if (mode === 'search') {
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, 'Buscar en el chat · enter o esc cierra'),
      h(Text, { wrap: 'truncate' }, clip(`/${query}█`, columns - 4)),
    );
  }
  if (wizard?.step === 'agent') {
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { bold: true }, 'Nueva sesión · elige agente'),
      ...agents.map((agent, index) => h(
        Text,
        { key: agent, inverse: index === wizard.index, wrap: 'truncate' },
        index === wizard.index ? `▸ ${agent}` : `  ${agent}`,
      )),
    );
  }
  if (wizard?.step === 'model') {
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `Modelo para ${wizard.agent} · enter lo deja vacío · esc vuelve`),
      h(Text, { wrap: 'truncate' }, `${wizard.model}█`),
    );
  }
  if (wizard?.step === 'prompt') {
    const promptLines = (wizard.prompt || ' ').split('\n');
    const shown = promptLines.slice(-3);
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `Prompt de ${wizard.agent} · enter línea · Ctrl+S envía · esc vuelve`),
      ...shown.map((line, index) => h(Text, { key: `${index}:${line}`, wrap: 'truncate' }, clip(index === shown.length - 1 ? `${line}█` : line, columns - 4))),
    );
  }
  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, { wrap: 'truncate' }, clip(`› ${draft}█`, columns - 4)),
    h(Text, { dimColor: true, wrap: 'truncate' }, clip('enter encola · ctrl+enter envía ya · alt+enter igual · ↑ elige en cola · esc borra', columns - 4)),
  );
}
