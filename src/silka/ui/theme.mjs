import { cellRatio, markGrid, renderMark, SILKA_PALETTE, trimGrid } from './logo.mjs';
// Tema de Silka: todo el color del TUI sale de aquí.
// Paleta tomada del logo (hachas acero + filo y anillo violeta). Ink/chalk degradan solos
// a 256 o 16 colores según la terminal; aquí solo respetamos NO_COLOR y SILKA_NO_ANIM.

export function colorOn(env = process.env) {
  return !('NO_COLOR' in env) && env.SILKA_NO_COLOR !== '1' && env.TERM !== 'dumb';
}

export function animOn(env = process.env) {
  return colorOn(env) && env.SILKA_NO_ANIM !== '1' && env.CI === undefined;
}

// Lenguaje visual de Antigravity CLI: texto claro sobre carbón, el prompt del usuario en
// azul grisáceo, las herramientas con nombre amarillo y viñeta oliva, enlaces en azul.
export const palette = {
  ink: '#E4E4E7',      // texto del agente
  prompt: '#AFC0E8',   // "> lo que escribió el usuario"
  tool: '#E5C07B',     // nombre de la herramienta
  dot: '#C6C98A',      // viñeta ● de herramienta ok
  args: '#A1A1AA',     // argumentos (entre paréntesis)
  link: '#6CB6FF',     // rutas y referencias
  muted: '#8B8B94',    // metadatos, "Thought for…", ayudas
  rule: '#4A4A53',     // líneas y separadores
  title: '#8AB4F8',    // "Silka 0.1.0"
  ok: '#C6C98A',
  run: '#E5C07B',
  bad: '#E06C75',
  // compatibilidad con el resto del TUI
  steel: '#E4E4E7',
  steelDim: '#A1A1AA',
  edge: '#AFC0E8',
  ring: '#4C8DF6',
  gem: '#E5C07B',
};

/** Un color fijo por harness: el autor se reconoce sin leer el nombre. */
export const agentColors = {
  claude: '#D97757',
  codex: '#10A37F',
  cursor: '#60A5FA',
  opencode: '#F59E0B',
  tú: '#F5F3FF',
};

export function agentColor() {
  return palette.ink;
}

export function statusTone(status) {
  if (status === 'running' || status === 'cancelling') return palette.run;
  if (status === 'failed') return palette.bad;
  if (status === 'cancelled') return palette.muted;
  return palette.ok;
}

/** `c(color)` devuelve el color o undefined si NO_COLOR. Úsalo en todas las props de Ink. */
export function c(color, env = process.env) {
  return colorOn(env) ? color : undefined;
}

function hexToRgb(hex) {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
export function mix(a, b, t) {
  const x = hexToRgb(a); const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * Math.min(1, Math.max(0, t))));
}

/** Texto en degradado: un segmento por carácter. */
export function gradientSegments(text, from, to) {
  const chars = [...String(text)];
  return chars.map((ch, i) => ({ text: ch, color: mix(from, to, chars.length > 1 ? i / (chars.length - 1) : 0) }));
}

/**
 * Brillo que recorre un texto (como el estado activo de Claude Code).
 * `frame` avanza con el tiempo; el resto del texto queda en `base`.
 */
export function shimmerSegments(text, frame, base = palette.steelDim, glow = palette.gem) {
  const chars = [...String(text)];
  const span = chars.length + 6;
  const head = (frame % span) - 3;
  return chars.map((ch, i) => {
    const d = Math.abs(i - head);
    return { text: ch, color: d > 2 ? base : mix(glow, base, d / 3) };
  });
}

/** Verbos del spinner: el tema es el taller (hachas, madera), no "Thinking". */
export const VERBS = ['Forjando', 'Afilando', 'Tallando', 'Templando', 'Desbastando', 'Cepillando', 'Ensamblando', 'Puliendo', 'Midiendo', 'Hendiendo'];
export const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

// ---- logo: dos hachas cruzadas y un anillo, en pixel art de medio bloque ---------
// Se genera con geometría (no a mano), así escala a cualquier tamaño.
const LOGO_STOPS = ['#F2A44C', '#E5534B', '#9B6BF2', '#4C8DF6', '#5FB7E8', '#7EC66B'];
/** Color de un píxel según su posición: cálidos arriba, fríos a los lados y abajo. */
function logoTint(u, v) {
  const t = Math.min(1, Math.max(0, (Math.atan2(v + 1.1, u) / Math.PI)));
  const i = Math.min(LOGO_STOPS.length - 2, Math.floor(t * (LOGO_STOPS.length - 1)));
  return mix(LOGO_STOPS[i], LOGO_STOPS[i + 1], t * (LOGO_STOPS.length - 1) - i);
}

function logoPixel(x, y, W, H) {
  const shape = logoShape(x, y, W, H);
  if (!shape) return null;
  const u = ((x + 0.5) / W) * 2 - 1;
  const v = ((y + 0.5) / H) * 2 - 1;
  return logoTint(u, v);
}

function logoShape(x, y, W, H) {
  const u = ((x + 0.5) / W) * 2 - 1;
  const v = ((y + 0.5) / H) * 2 - 1;
  const r = Math.hypot(u, v);
  if (Math.abs(u) + Math.abs(v) < 0.13) return palette.gem; // gema central
  for (const s of [-1, 1]) {
    // mango: diagonal desde la cabeza (arriba) hasta la esquina opuesta (abajo)
    const ax = s * -0.62; const ay = -0.62; const bx = s * 0.78; const by = 0.9;
    const dx = bx - ax; const dy = by - ay;
    const t = ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy);
    if (t > -0.12 && t < 1) {
      const px = ax + t * dx; const py = ay + t * dy;
      if (Math.hypot(u - px, v - py) < 0.085) return mix(palette.steel, palette.steelDim, (v + 1) / 2);
    }
    // cabeza: sector de círculo hacia afuera, con el filo violeta en el borde curvo
    const hx = s * -0.6; const hy = -0.58;
    const d = Math.hypot(u - hx, v - hy);
    const outward = s * (hx - u);
    if (d < 0.42 && outward > -0.02 && Math.abs(v - hy) < 0.36) {
      return d > 0.32 ? palette.edge : mix(palette.steel, palette.steelDim, d / 0.42);
    }
  }
  // anillo con cortes donde pasan los mangos (como en el logo)
  if (Math.abs(r - 0.6) < 0.075 && Math.abs(Math.abs(u) - Math.abs(v)) > 0.16) return palette.ring;
  return null;
}

/**
 * Logo en filas de segmentos para Ink: cada celda es '▀' con color arriba/abajo,
 * así cada carácter muestra 2 píxeles verticales (cuadrados).
 */
export function logoRows(width = 64, env = process.env) {
  // 64×64 para el banner principal; 32×32 cuando no hay sitio. Paleta original de la marca.
  const grid = trimGrid(markGrid(width >= 64 ? 64 : 32));
  return renderMark(grid, { ratio: cellRatio(env), color: colorOn(env), colorOf: (name) => SILKA_PALETTE[name] });
}
