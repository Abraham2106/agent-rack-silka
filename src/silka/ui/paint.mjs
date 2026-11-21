// Pequeñas piezas de pintura para Ink: segmentos de color, logo, línea de estado animada.
import { agentColor, animOn, c, gradientSegments, logoRows, palette, shimmerSegments, SPINNER, VERBS } from './theme.mjs';

/** Una línea hecha de segmentos [{text,color,backgroundColor,bold,dim}]. */
export function segLine(h, Text, segs, key) {
  return h(
    Text,
    { key, wrap: 'truncate' },
    ...segs.map((s, i) => h(Text, {
      key: i,
      color: c(s.color),
      backgroundColor: c(s.backgroundColor),
      bold: s.bold,
      dimColor: s.dim,
    }, s.text)),
  );
}

/** Marca de texto con degradado del logo. */
export function wordmark(text = 'silka') {
  return gradientSegments(text, palette.edge, palette.gem).map((s) => ({ ...s, bold: true }));
}

/** Pantalla de bienvenida / estado vacío: logo grande + nombre + qué hacer. */
export function renderSplash(h, Box, Text, { width, height, hint }) {
  const logoW = width >= 60 && height >= 18 ? 26 : width >= 40 && height >= 12 ? 16 : 0;
  const rows = logoW ? logoRows(logoW) : [];
  const pad = (n) => ' '.repeat(Math.max(0, n));
  const left = Math.floor((width - (logoW || 20)) / 2);
  const lines = [
    ...rows.map((segs, i) => segLine(h, Text, [{ text: pad(left) }, ...segs], `l${i}`)),
    h(Text, { key: 'gap1' }, ' '),
    segLine(h, Text, [{ text: pad(Math.floor((width - 5) / 2)) }, ...wordmark()], 'wm'),
    segLine(h, Text, [{ text: pad(Math.floor((width - 33) / 2)) }, { text: 'Claude manda. Los demás trabajan.', color: palette.steelDim }], 'tag'),
    h(Text, { key: 'gap2' }, ' '),
    segLine(h, Text, [{ text: pad(Math.floor((width - String(hint).length) / 2)) }, { text: hint, color: palette.muted }], 'hint'),
  ];
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  return h(Box, { width, height, flexDirection: 'column', overflow: 'hidden' }, ...Array.from({ length: top }, (_, i) => h(Text, { key: `t${i}` }, ' ')), ...lines);
}

/**
 * Línea viva del agente activo, como Claude Code: spinner, verbo con brillo,
 * tiempo y la herramienta en curso. Sin animación (NO_COLOR / SILKA_NO_ANIM) queda fija.
 */
export function activityLine({ frame, agent, elapsed, tool }) {
  const anim = animOn();
  const spin = anim ? SPINNER[frame % SPINNER.length] : '✻';
  const verb = `${VERBS[Math.floor(frame / 30) % VERBS.length]}…`;
  const color = agentColor(agent);
  return [
    { text: `${spin} `, color },
    ...(anim ? shimmerSegments(verb, frame) : [{ text: verb, color: palette.steelDim }]),
    { text: `  ${elapsed}`, color: palette.muted },
    ...(tool ? [{ text: '  ·  ', color: palette.rule }, { text: tool, color: palette.steelDim }] : []),
    { text: '   ctrl+enter interrumpe', color: palette.rule },
  ];
}
