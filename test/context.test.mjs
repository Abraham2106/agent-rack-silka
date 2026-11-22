import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assembleTaskContext, ASSEMBLY_ORDER } from '../src/silka/context/assemble.mjs';
import { ensureRepoPackage, repoPackageSha } from '../src/silka/context/repo-package.mjs';
import { applySectionBudget } from '../src/silka/context/budget.mjs';
import { getContextRef, resetContextRefStore } from '../src/silka/context/ref-store.mjs';
import { createApiDispatcher } from '../src/silka/codemode/api-dispatch.mjs';

test('T-CX-01 mismo commit → mismo paquete y orden', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cx-'));
  const sha = repoPackageSha(root);
  const a = assembleTaskContext(root, { title: 'A', prompt: 'uno' });
  const b = assembleTaskContext(root, { title: 'B', prompt: 'dos' });
  assert.equal(a.sha, b.sha);
  assert.equal(a.sha, sha);
  assert.deepEqual(a.assemblyOrder, ASSEMBLY_ORDER);
  assert.deepEqual(b.assemblyOrder, ASSEMBLY_ORDER);
  const pkg2 = ensureRepoPackage(root);
  assert.equal(pkg2.cached, true);
  assert.ok(a.packagePath.endsWith(`${sha.slice(0, 40)}.md`));
});

test('T-CX-02 presupuesto omite secciones enteras con puntero', () => {
  resetContextRefStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cx-b-'));
  const sections = [
    { id: 'a', title: 'Baja', body: 'x'.repeat(2000), priority: 1 },
    { id: 'b', title: 'Alta', body: 'encargo corto', priority: 5 },
  ];
  const out = applySectionBudget(root, sections, 500);
  assert.ok(out.dropped.includes('a'));
  assert.ok(out.fullRef?.startsWith('ctx:'));
  assert.doesNotMatch(out.text, /x{100,}/);
  const full = getContextRef(out.fullRef, root);
  assert.ok(full.includes('x'.repeat(100)));
});

test('silka.get resuelve ctx:', async () => {
  resetContextRefStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-cx-get-'));
  const sections = [
    { id: 'a', title: 'Drop', body: 'z'.repeat(800), priority: 1 },
    { id: 'b', title: 'Keep', body: 'ok', priority: 9 },
  ];
  const out = applySectionBudget(root, sections, 120);
  const dispatch = createApiDispatcher({
    workspace: root,
    callHub: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    callBridgeTool: async () => '',
    listSessions: async () => [],
  });
  const body = await dispatch(['get'], [out.fullRef]);
  assert.ok(String(body).includes('z'.repeat(50)));
});