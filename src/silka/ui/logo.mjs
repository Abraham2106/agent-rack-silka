// Silka Pixel Mark v1.0 — según la guía de construcción:
//   rejilla 32×32 (1 módulo = 1u), marca 24u×24u, margen 4u, centro de simetría (16,16).
//   Mangos de 3u a 45° y 135° · hojas ≈9u de ancho con curva exterior escalonada y filo
//   violeta · anillo segmentado (4 arcos) de 2u detrás de las hachas · diamante central 2u.
// Un hacha se define en coordenadas del mango (a lo largo / a través) y la otra es su espejo.

export const SILKA_PALETTE = {
  void: '#0F0F14',
  steel: '#23232B',
  violet: '#5B2ED9',
  violetMid: '#7B3FF2',
  violetLight: '#A855F7',
};

// Variante "On dark (CLI)": el acero #23232B casi desaparece sobre fondo oscuro, se aclara.
export const ON_DARK = { steel: '#4A4A58', steelShade: '#3A3A46' };

const N = 32;
const C = 16;
const S = Math.SQRT1_2;

/** Hacha A: cabeza arriba-izquierda, mango hacia abajo-derecha. Devuelve un nombre de color o null. */
function axe(px, py) {
  const dx = px - C;
  const dy = py - C;
  const a = (dx + dy) * S;  // a lo largo del mango: negativo = hacia la cabeza
  const c = (dx - dy) * S;  // a través: negativo = abajo-izquierda (lado de la hoja)
  // Hoja: media elipse del lado de la hoja, con la curva exterior escalonada (≈9u de ancho).
  const e = ((a + 8.4) / 5.3) ** 2 + ((c + 0.2) / 8.6) ** 2;
  const bite = Math.hypot(a + 4.2, c + 4.9) < 3.7; // escotadura interior junto al mango
  if (c < 0.2 && a < -3 && e <= 1 && !bite) {
    if (e > 0.62) return e > 0.84 ? 'violetLight' : 'violetMid'; // filo de ~2px
    return c < -6.2 ? 'steelShade' : 'steel';
  }
  // Espolón superior (talón de la cabeza) del otro lado del mango, afinándose hacia arriba.
  if (c >= 0.2 && c < 3.6 && a > -14.2 && a < -9.6 && c < 3.6 - (-9.6 - a) * 0.55) return 'steel';
  // Mango de 3u.
  if (Math.abs(c) < 1.6 && a > -12.4 && a < 16.2) return 'steel';
  return null;
}

/** Anillo de 2u en 4 arcos (arriba, abajo, izquierda, derecha), cortado en las diagonales. */
function ring(px, py) {
  const r = Math.hypot(px - C, py - C);
  if (r < 6.2 || r > 8.3) return null;
  const deg = ((Math.atan2(py - C, px - C) * 180) / Math.PI + 360) % 360;
  for (const center of [0, 90, 180, 270]) {
    const d = Math.abs(((deg - center + 540) % 360) - 180);
    if (d < 27) return center === 270 ? 'violetMid' : 'violet';
  }
  return null;
}

/** Mapa 32×32 de nombres de color (o null). */
export function silkaMarkGrid() {
  const grid = [];
  for (let y = 0; y < N; y += 1) {
    const row = [];
    for (let x = 0; x < N; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const body = axe(px, py) || axe(N - px, py); // espejo exacto respecto de x = 16
      let pixel = ring(px, py);
      if (body) pixel = body;
      if (Math.abs(px - C) + Math.abs(py - C) <= 2.05) pixel = 'violetLight'; // diamante 2u
      row.push(pixel);
    }
    grid.push(row);
  }
  return grid;
}

/** Recorta al cuadro de la marca (24u), sin el margen de 4u. */
export function silkaMarkCropped() {
  return silkaMarkGrid().slice(4, 28).map((row) => row.slice(4, 28));
}

/** Color real de cada nombre para fondo oscuro (CLI). */
export function markColor(name) {
  if (!name) return null;
  return ON_DARK[name] || SILKA_PALETTE[name] || null;
}
