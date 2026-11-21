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
  const rows = logoRows(16, {});
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.length === 16));
  assert.ok(rows.flat().some((s) => s.text !== ' '));
  assert.ok(logoRows(16, { NO_COLOR: '' }).flat().every((s) => !s.color)); // NO_COLOR: sin color
});

test('Silka Pixel Mark: 32×32, marca de 24u con margen de 4u y simetría en espejo', async () => {
  const { silkaMarkGrid, silkaMarkCropped } = await import('../src/silka/ui/logo.mjs');
  const grid = silkaMarkGrid();
  assert.equal(grid.length, 32);
  assert.ok(grid.every((row) => row.length === 32));
  for (const row of grid) for (let x = 0; x < 16; x += 1) assert.equal(row[x], row[31 - x]);
  // margen libre de 4u arriba, a la izquierda y a la derecha
  for (const y of [0, 1, 2, 3]) assert.ok(grid[y].every((p) => !p));
  for (const row of grid) for (const x of [0, 1, 2, 31, 30, 29]) assert.equal(row[x], null);
  // diamante central y anillo violeta presentes
  assert.equal(grid[15][15], 'violetLight');
  assert.ok(grid.flat().some((p) => p === 'violet'));
  assert.equal(silkaMarkCropped().length, 24);
});
