import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readSkills, skillsPrefix, skillRoleForTask, SKILLS_BUDGET_BYTES } from '../src/silka/skills.mjs';

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'silka-skills-'));
}

function writeSkill(ws, role, fileName, text) {
  const dir = path.join(ws, '.silka', 'skills', role);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), text);
}

function skillText({ rol = 'implementador', alcance = 'src/silka/ui/', body = 'Cuidar el render.' } = {}) {
  return `---\nrol: ${rol}\nalcance: ${alcance}\n---\n${body}\n`;
}

test('RS-01 una skill sin rol en la cabecera se ignora con su causa y no rompe la lectura', () => {
  const ws = tempWorkspace();
  writeSkill(ws, 'implementador', 'sin-rol.md', '---\nalcance: src/silka/\n---\nHola\n');
  writeSkill(ws, 'implementador', 'buena.md', skillText({ alcance: 'src/silka/ui/' }));
  const { valid, invalid } = readSkills(ws);
  assert.deepEqual(valid.map((s) => s.name), ['buena']);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].path, /sin-rol\.md$/);
  assert.match(invalid[0].reason, /no declara rol/);
});

test('RS-01 una skill cuyo rol no coincide con su carpeta o sin alcance se rechaza', () => {
  const ws = tempWorkspace();
  writeSkill(ws, 'revisor', 'mal.md', skillText({ rol: 'implementador' }));
  writeSkill(ws, 'revisor', 'sin-alcance.md', '---\nrol: revisor\n---\nRevisar.\n');
  const { valid, invalid } = readSkills(ws);
  assert.equal(valid.length, 0);
  assert.equal(invalid.length, 2);
  assert.ok(invalid.some((i) => /no coincide con la carpeta/.test(i.reason)));
  assert.ok(invalid.some((i) => /no declara alcance/.test(i.reason)));
});

test('RS-05 un nombre que intenta salir con ".." se rechaza sin leer el archivo', () => {
  const ws = tempWorkspace();
  writeSkill(ws, 'implementador', 'a..b.md', skillText());
  const { valid, invalid } = readSkills(ws);
  assert.equal(valid.length, 0);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /no puede salir/);
});

test('RS-02 solo las skills del rol de la tarea y del alcance coincidente', () => {
  const ws = tempWorkspace();
  writeSkill(ws, 'implementador', 'ui.md', skillText({ alcance: 'src/silka/ui/', body: 'Regla UI.' }));
  writeSkill(ws, 'implementador', 'tasks.md', skillText({ alcance: 'src/silka/tasks/', body: 'Regla tareas.' }));
  writeSkill(ws, 'revisor', 'rev-ui.md', skillText({ rol: 'revisor', alcance: 'src/silka/ui/', body: 'Revisa UI.' }));
  const prefix = skillsPrefix(ws, { taskRole: 'implementar', scope: ['src/silka/ui/'] });
  assert.match(prefix, /Regla UI\./);
  assert.doesNotMatch(prefix, /Regla tareas\./);
  assert.doesNotMatch(prefix, /Revisa UI\./);
  assert.match(prefix, /Skills del rol implementador/);
});

test('RS-03 el tope de 3 KB deja el resto por referencia', () => {
  const ws = tempWorkspace();
  const big = 'x'.repeat(2000);
  writeSkill(ws, 'implementador', 'a.md', skillText({ alcance: 'src/silka/', body: `A ${big}` }));
  writeSkill(ws, 'implementador', 'b.md', skillText({ alcance: 'src/silka/', body: `B ${big}` }));
  const prefix = skillsPrefix(ws, { taskRole: 'implementar', scope: ['src/silka/ui/'] });
  assert.ok(Buffer.byteLength(prefix, 'utf8') <= SKILLS_BUDGET_BYTES + 200);
  assert.match(prefix, /A xxx/);
  assert.doesNotMatch(prefix, /B xxx/);
  assert.match(prefix, /Otras 1 skills no caben en el tope/);
});

test('la tarea de planificar o verificar no recibe skills y sin skills no hay prefijo', () => {
  const ws = tempWorkspace();
  writeSkill(ws, 'implementador', 'ui.md', skillText({ alcance: 'src/silka/ui/' }));
  assert.equal(skillsPrefix(ws, { taskRole: 'planificar', scope: ['src/silka/ui/'] }), '');
  assert.equal(skillRoleForTask('revisar'), 'revisor');
  assert.equal(skillsPrefix(tempWorkspace(), { taskRole: 'implementar', scope: ['src/silka/ui/'] }), '');
});

test('RS-04 silka skills ls muestra las válidas y marca la inválida con su causa; --json para el manager', async () => {
  const { skillsCommand } = await import('../src/silka/skills.mjs');
  const ws = tempWorkspace();
  writeSkill(ws, 'implementador', 'ui.md', skillText({ alcance: 'src/silka/ui/' }));
  writeSkill(ws, 'revisor', 'rev.md', skillText({ rol: 'revisor', alcance: 'src/silka/' }));
  writeSkill(ws, 'implementador', 'roto.md', '---\nalcance: src/\n---\nSin rol.\n');
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    skillsCommand(['ls', '--workspace', ws]);
    skillsCommand(['ls', '--json', '--workspace', ws]);
  } finally {
    console.log = original;
  }
  const text = lines.slice(0, -1).join('\n');
  assert.match(text, /implementador\tsrc\/silka\/ui\/\t\d+ B\t\.silka\/skills\/implementador\/ui\.md/);
  assert.match(text, /revisor\tsrc\/silka\/\t/);
  assert.match(text, /INVÁLIDA\t\.silka\/skills\/implementador\/roto\.md\tla cabecera no declara rol/);
  const json = JSON.parse(lines[lines.length - 1]);
  assert.equal(json.valid.length, 2);
  assert.equal(json.invalid.length, 1);
  assert.deepEqual(json.valid.find((s) => s.name === 'ui').scope, ['src/silka/ui/']);
});
