import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFilter, fuzzyScore, parseCodexCache, parseCursorModels, parseOpencodeModels, pickerItems,
} from '../src/silka/models.mjs';
import { gradientSegments, logoRows, mix, shimmerSegments } from '../src/silka/ui/theme.mjs';

test('cursor: líneas "id - Nombre" y marca de default', () => {
  const models = parseCursorModels('Available models\n\nauto - Auto (default)\ngrok-4.7-medium - Grok 4.7  Medium​\nbasura sin guion\n');
  assert.deepEqual(models.map((m) => m.id), ['auto', 'grok-4.7-medium']);
  assert.equal(models[0].default, true);
  assert.equal(models[1].name, 'Grok 4.7 Medium');
  assert.equal(models[1].provider, 'xai');
});

test('opencode: proveedor/modelo y gratis', () => {
  const models = parseOpencodeModels('opencode/hy4-flash-free\nopenrouter/google/gemma:free\nopenrouter/tencent/hy4\nnada\n');
  assert.equal(models.length, 3);
  assert.equal(models[0].provider, 'opencode');
  assert.equal(models[0].free, true);
  assert.equal(models[1].free, true);
  assert.equal(models[2].free, false);
});

test('codex: cache ordenado por prioridad y sin ocultos', () => {
  const models = parseCodexCache({ models: [
    { slug: 'b', priority: 2, visibility: 'list' },
    { slug: 'oculto', priority: 0, visibility: 'hide' },
    { slug: 'a', priority: 1, visibility: 'list', display_name: 'A', description: 'Rápido. Más texto' },
  ] });
  assert.deepEqual(models.map((m) => m.id), ['a', 'b']);
  assert.equal(models[0].note, 'Rápido');
});

test('filtros por agente: regex sobre el id', () => {
  const models = ['composer-2.5', 'grok-4.7-low', 'gpt-5', 'gemini-4-neon-low', 'cursor-grok-4.6-high'].map((id) => ({ id }));
  const kept = applyFilter(models, ['grok-4\\.6', 'grok-4\\.7', 'neon', 'composer-2\\.5']);
  assert.deepEqual(kept.map((m) => m.id), ['composer-2.5', 'grok-4.7-low', 'gemini-4-neon-low', 'cursor-grok-4.6-high']);
  assert.equal(applyFilter(models, []).length, 5);
  assert.equal(applyFilter(models, ['[']).length, 0); // patrón inválido no rompe
});

test('búsqueda difusa y orden del selector', () => {
  assert.ok(fuzzyScore('grok47', 'grok-4.7-medium') > 0);
  assert.equal(fuzzyScore('zzz', 'grok-4.7-medium'), 0);
  const catalog = { models: [
    { id: 'x/lento', name: 'lento', provider: 'x', available: true },
    { id: 'x/malo', name: 'malo', provider: 'x', available: false },
    { id: 'x/def', name: 'def', provider: 'x', available: true },
    { id: 'x/rec', name: 'rec', provider: 'x', available: true },
  ] };
  const items = pickerItems(catalog, { defaultModel: 'x/def', recents: ['x/rec'] });
  assert.deepEqual(items.slice(0, 2).map((m) => m.id), ['x/def', 'x/rec']);
  assert.equal(items[0].isDefault, true);
  assert.equal(items.at(-1).id, 'x/malo'); // no disponible al final
});

test('tema: mezcla, degradado, brillo y logo', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  const seg = gradientSegments('silka', '#000000', '#ffffff');
  assert.equal(seg.length, 5);
  assert.equal(seg[0].color, '#000000');
  assert.equal(seg[4].color, '#ffffff');
  assert.equal(shimmerSegments('Forjando…', 3).length, 9);
  const rows = logoRows(32, {});
  assert.ok(rows.length >= 10 && rows.length <= 16);
  assert.ok(rows.every((r) => r.length === rows[0].length));
  assert.ok(rows.flat().some((s) => s.text !== ' '));
  assert.ok(logoRows(32, { NO_COLOR: '' }).flat().every((s) => !s.color)); // NO_COLOR: sin color
});

test('Silka Pixel Mark: 64 y 32 desde el arte original, simétricas y con el diamante separado', async () => {
  const { markGrid, renderMark, trimGrid } = await import('../src/silka/ui/logo.mjs');
  for (const size of [64, 32]) {
    const grid = markGrid(size);
    assert.equal(grid.length, size);
    assert.ok(grid.every((row) => row.length === size));
    for (const row of grid) for (let x = 0; x < size / 2; x += 1) assert.equal(row[x], row[size - 1 - x]); // espejo exacto
    const c = size / 2;
    assert.ok(grid[c - 1][c - 1]?.startsWith('violet')); // diamante en el centro
    // anillo de aire: justo fuera del diamante no hay acero (no se toca con los mangos)
    let r = 0;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c);
      if (d < size * 0.09 && grid[y][x]?.startsWith('violet')) r = Math.max(r, d);
    }
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c);
      if (d > r && d <= r + 1) assert.equal(grid[y][x], null);
    }
    assert.ok(grid.flat().includes('violet') && grid.flat().includes('steel'));
  }
  // relación de aspecto: con celdas 1:2 cada carácter = 2 píxeles; con celdas más altas, menos filas
  const g = trimGrid(markGrid(64));
  assert.equal(renderMark(g, { ratio: 2 }).length, Math.ceil(g.length / 2));
  assert.ok(renderMark(g, { ratio: 2.4 }).length < renderMark(g, { ratio: 2 }).length);
  // sin suavizado: solo los colores de la paleta (o nada)
  const colors = new Set(renderMark(g).flat().flatMap((s) => [s.color, s.backgroundColor]).filter(Boolean));
  for (const col of colors) assert.ok(['#23232B', '#5B2ED9', '#7B3FF2', '#A855F7'].includes(col));
});
