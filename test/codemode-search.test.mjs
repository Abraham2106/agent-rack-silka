import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSignatureBlocks, searchSignatures } from '../src/silka/codemode/search.mjs';
import { SILKA_API_VERSION } from '../src/silka/codemode/version.mjs';

const SAMPLE = `
export interface TaskSpec {
  title: string;
  setup?: string | string[];
  setupMode?: 'link' | 'install';
}

export interface LaunchOptions {
  isolate?: 'worktree';
}
`;

test('extractSignatureBlocks incluye el cuerpo completo de una interface', () => {
  const blocks = extractSignatureBlocks(SAMPLE);
  const task = blocks.find((b) => b.includes('TaskSpec'));
  assert.ok(task, 'falta bloque TaskSpec');
  assert.match(task, /title: string/);
  assert.match(task, /setup\?:/);
  assert.match(task, /setupMode\?:/);
  assert.match(task, /\n\}/);
});

test('silka_search devuelve TaskSpec con campos del modelo (FR-CM-01)', () => {
  const hit = searchSignatures('TaskSpec title deliver');
  assert.equal(hit.version, SILKA_API_VERSION);
  assert.match(hit.fragments, /export interface TaskSpec/);
  assert.match(hit.fragments, /title: string/);
  assert.match(hit.fragments, /deliver\?:/);
  assert.ok(hit.bytes <= 4096);
});

test('silka_search documenta isolate, setup y setupMode (FR-CM-04)', () => {
  const isolate = searchSignatures('isolate worktree launch');
  assert.match(isolate.fragments, /isolate\?: 'worktree'/);

  const setup = searchSignatures('TaskSpec setup setupMode');
  assert.match(setup.fragments, /setup\?:/);
  assert.match(setup.fragments, /setupMode\?: 'link' \| 'install'/);
});

test('silka_search informa semver del contrato (FR-CM-08)', () => {
  const hit = searchSignatures('wait');
  assert.equal(hit.version, '1.4.0');
  assert.match(hit.version, /^\d+\.\d+\.\d+$/);
});