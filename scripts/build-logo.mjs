// Reconstruye el Silka Pixel Mark desde el arte original (docs/assets/logo.png).
//   node scripts/build-logo.mjs [--preview]
// Lee el PNG (decodificador mínimo, sin dependencias), recorta la marca, la divide en una
// rejilla de 64×64 celdas cuadradas y clasifica cada celda por mayoría de píxeles:
// fondo · cuerpo del hacha · violeta (3 tonos por luminosidad). Después impone simetría
// exacta y deja aire alrededor del diamante central. Escribe src/silka/ui/logo-data.mjs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- PNG mínimo: 8 bits, RGB/RGBA, sin entrelazado ------------------------------------
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0; let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`PNG no soportado (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, bpp, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255]; } };
}

// ---- clasificación de un píxel ----------------------------------------------------------
function classify([r, g, b, a]) {
  if (a < 128) return 'bg';
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const sat = max ? (max - min) / max : 0;
  if (lum > 200 && sat < 0.15) return 'bg';                // blanco del lienzo
  if (sat > 0.35 && b > r && b > g) return 'violet';       // violeta / morado
  if (lum < 110) return 'steel';                           // cuerpo oscuro del hacha
  return 'bg';
}

const png = decodePng(path.join(root, 'docs/assets/logo.png'));

// bbox de la marca
let x0 = png.width; let y0 = png.height; let x1 = 0; let y1 = 0;
for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
  if (classify(png.px(x, y)) !== 'bg') { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
}

/** Rejilla NxN de la marca, con `margin` celdas de aire, celdas cuadradas, centrada. */
function sampleGrid(N, margin) {
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const cell = side / (N - 2 * margin);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const gx0 = cx - (N / 2) * cell; const gy0 = cy - (N / 2) * cell;
  const grid = [];
  for (let gy = 0; gy < N; gy += 1) {
    const row = [];
    for (let gx = 0; gx < N; gx += 1) {
      const counts = { bg: 0, steel: 0, violet: 0 };
      let vlum = 0;
      const sx0 = Math.floor(gx0 + gx * cell); const sx1 = Math.floor(gx0 + (gx + 1) * cell);
      const sy0 = Math.floor(gy0 + gy * cell); const sy1 = Math.floor(gy0 + (gy + 1) * cell);
      for (let y = Math.max(0, sy0); y < Math.min(png.height, sy1); y += 1) {
        for (let x = Math.max(0, sx0); x < Math.min(png.width, sx1); x += 1) {
          const p = png.px(x, y); const k = classify(p);
          counts[k] += 1;
          if (k === 'violet') vlum += (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000;
        }
      }
      const total = counts.bg + counts.steel + counts.violet || 1;
      // Un píxel es tinta si al menos ~45% de su celda lo es (sin suavizado: un solo color).
      let k = null;
      if (counts.violet / total >= 0.42) {
        const l = vlum / counts.violet;
        k = l < 70 ? 'violet' : l < 95 ? 'violetMid' : 'violetLight';
      } else if ((counts.steel + counts.violet) / total >= 0.45) k = 'steel';
      row.push(k);
    }
    grid.push(row);
  }
  return grid;
}

/** Simetría exacta: cada par espejo toma el valor "más tinta" (no pierde trazos finos). */
function symmetrize(grid) {
  const N = grid.length; const rank = { null: 0, steel: 1, violet: 2, violetMid: 3, violetLight: 4 };
  for (const row of grid) for (let x = 0; x < N / 2; x += 1) {
    const a = row[x]; const b = row[N - 1 - x];
    const v = rank[a] >= rank[b] ? a : b;
    row[x] = v; row[N - 1 - x] = v;
  }
  return grid;
}

/** Aire alrededor del diamante: el diamante (violeta) se separa de los mangos. */
function clearDiamond(grid) {
  const N = grid.length; const c = N / 2;
  // el diamante es el violeta más cercano al centro; su radio L1
  let r = 0;
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c);
    if (d < N * 0.09 && grid[y][x] && grid[y][x].startsWith('violet')) r = Math.max(r, d);
  }
  const gap = Math.max(1, Math.round(N / 48));
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c);
    if (d <= r) grid[y][x] = d <= r * 0.45 ? 'violetLight' : 'violetMid';
    else if (d <= r + gap) grid[y][x] = null;
  }
  return grid;
}

const big = clearDiamond(symmetrize(sampleGrid(64, 3)));
const small = clearDiamond(symmetrize(sampleGrid(32, 1)));

const code = { null: '.', steel: '#', violet: 'o', violetMid: 'O', violetLight: '@' };
const toRows = (g) => g.map((row) => row.map((p) => code[p]).join(''));
const out = `// GENERADO por scripts/build-logo.mjs desde docs/assets/logo.png. No editar a mano.
// Leyenda: . vacío · # cuerpo del hacha · o violeta #5B2ED9 · O #7B3FF2 · @ #A855F7
export const MARK_64 = ${JSON.stringify(toRows(big), null, 2)};

export const MARK_32 = ${JSON.stringify(toRows(small), null, 2)};
`;
fs.writeFileSync(path.join(root, 'src/silka/ui/logo-data.mjs'), out);
console.log(`bbox ${x0},${y0}-${x1},${y1} · 64×64 y 32×32 escritos en src/silka/ui/logo-data.mjs`);
if (process.argv.includes('--preview')) {
  for (const line of toRows(big)) console.log(line);
  console.log();
  for (const line of toRows(small)) console.log(line);
}
