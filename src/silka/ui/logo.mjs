// Silka Pixel Mark para la terminal.
// Las rejillas salen del arte original (scripts/build-logo.mjs → logo-data.mjs):
//   MARK_64 para el banner principal, MARK_32 para espacios reducidos.
// Render con medio bloque (▀/▄): cada carácter muestra 2 píxeles verticales. Un píxel es
// cuadrado solo si la celda mide exactamente 1:2; como no todas las fuentes lo cumplen,
// se re-muestrea en vertical según la proporción real de la celda (SILKA_CELL_RATIO,
// alto/ancho, por defecto 2.0). Sin suavizado: vecino más cercano, un color por píxel.
import { MARK_32, MARK_64 } from './logo-data.mjs';

export const SILKA_PALETTE = {
  void: '#0F0F14',
  steel: '#23232B',
  violet: '#5B2ED9',
  violetMid: '#7B3FF2',
  violetLight: '#A855F7',
};

const CODE = { '#': 'steel', o: 'violet', O: 'violetMid', '@': 'violetLight' };

function parse(rows) {
  return rows.map((line) => [...line].map((ch) => CODE[ch] || null));
}

/** Rejilla lógica (64 o 32) como matriz de nombres de color. */
export function markGrid(size = 64) {
  return parse(size >= 64 ? MARK_64 : MARK_32);
}

/** Quita filas y columnas vacías alrededor (la marca es más ancha que alta). */
export function trimGrid(grid) {
  const used = (row) => row.some(Boolean);
  let top = 0; let bottom = grid.length - 1;
  while (top < bottom && !used(grid[top])) top += 1;
  while (bottom > top && !used(grid[bottom])) bottom -= 1;
  const rows = grid.slice(top, bottom + 1);
  let left = rows[0].length; let right = 0;
  for (const row of rows) row.forEach((p, x) => { if (p) { left = Math.min(left, x); right = Math.max(right, x); } });
  return rows.map((row) => row.slice(left, right + 1));
}

/** Proporción alto/ancho de la celda de la terminal. */
export function cellRatio(env = process.env) {
  const v = Number(env.SILKA_CELL_RATIO);
  return Number.isFinite(v) && v >= 1.2 && v <= 3 ? v : 2;
}

/**
 * Filas de segmentos {text,color,backgroundColor} listas para Ink.
 * `colorOf(name)` decide el color final de cada píxel.
 */
export function renderMark(grid, { ratio = 2, colorOf = (n) => SILKA_PALETTE[n], color = true } = {}) {
  const H = grid.length; const W = grid[0]?.length || 0;
  // sub-píxeles verticales para que cada píxel lógico se vea cuadrado con esta celda
  const sub = Math.max(2, Math.round((H * 2) / ratio));
  const src = (j) => grid[Math.min(H - 1, Math.floor((j * ratio) / 2))];
  const rows = [];
  for (let j = 0; j < sub; j += 2) {
    const up = src(j); const down = j + 1 < sub ? src(j + 1) : null;
    const segs = [];
    for (let x = 0; x < W; x += 1) {
      const t = up?.[x] ? colorOf(up[x]) : null;
      const b = down?.[x] ? colorOf(down[x]) : null;
      if (!color) segs.push({ text: t || b ? '█' : ' ' });
      else if (t && b) segs.push(t === b ? { text: '█', color: t } : { text: '▀', color: t, backgroundColor: b });
      else if (t) segs.push({ text: '▀', color: t });
      else if (b) segs.push({ text: '▄', color: b });
      else segs.push({ text: ' ' });
    }
    rows.push(segs);
  }
  return rows;
}
