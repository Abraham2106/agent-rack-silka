import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-reg-'));
process.env.SILKA_CONFIG_DIR = cfg;
const { listTaskRepos, registerTaskRepo } = await import('../src/silka/tasks/repo-registry.mjs');

test('RR-01 repos con tareas en otros proyectos quedan registrados para los supervisores', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-otro-'));
  fs.mkdirSync(path.join(repo, '.silka', 'tasks-v1'), { recursive: true });
  registerTaskRepo(repo);
  registerTaskRepo(repo.toUpperCase());
  assert.deepEqual(listTaskRepos(), [path.resolve(repo)], 'sin duplicados aunque cambie la capitalización');
});

test('RR-02 un repo borrado (p. ej. temporal de pruebas) no se vigila', () => {
  const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-borrado-'));
  fs.mkdirSync(path.join(gone, '.silka', 'tasks-v1'), { recursive: true });
  registerTaskRepo(gone);
  fs.rmSync(gone, { recursive: true, force: true });
  assert.ok(!listTaskRepos().includes(path.resolve(gone)));
});
