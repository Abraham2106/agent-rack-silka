import assert from 'node:assert/strict';
import test from 'node:test';
import { originLabel as rowLabel, pad } from '../src/silka/format.mjs';
import { originLabel } from '../src/silka/origin.mjs';

test('pad deja un espacio y originLabel acorta el cliente', () => {
  assert.equal(pad('codex', 8), 'codex   ');
  assert.equal(pad('demasiado-largo', 8).endsWith(' '), true);
  assert.equal(pad('demasiado-largo', 8).length, 8);
  assert.equal(originLabel('codex-mcp-client'), 'codex');
  assert.equal(originLabel('claude-code'), 'claude');
  assert.equal(originLabel('evil\nclaude'), 'claude');
  assert.equal(originLabel(''), 'tú');
  assert.equal(rowLabel({ from: 'opencode' }), 'opencode');
  assert.equal(rowLabel({}), 'tú');
});
