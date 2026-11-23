// Skills por rol (openspec: role-skills). Son Markdown versionados en `.silka/skills/<rol>/<nombre>.md`
// con una cabecera `---` que declara `rol:` y `alcance:`. Solo se leen como texto: nunca se ejecutan ni
// se lee nada fuera de `.silka/skills/`. Las que no validan se ignoran con aviso; nunca impiden lanzar.
import fs from 'node:fs';
import path from 'node:path';
import { selectByScope } from './memory.mjs';

export const SKILL_ROLES = ['implementador', 'revisor', 'verificador'];
export const SKILLS_BUDGET_BYTES = 3072;

// Rol de la tarea (routing.mjs: planificar, implementar, revisar) -> rol de skill.
const TASK_ROLE_TO_SKILL = { implementar: 'implementador', revisar: 'revisor' };

export function skillRoleForTask(taskRole) {
  return TASK_ROLE_TO_SKILL[String(taskRole || '')] || '';
}

function skillsDir(workspace) {
  return path.join(path.resolve(String(workspace)), '.silka', 'skills');
}

/** Cabecera `---` con pares `clave: valor`; el cuerpo es el resto del archivo. */
export function parseSkillText(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { header: {}, body: text };
  const header = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) header[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { header, body: text.slice(match[0].length) };
}

function safeName(name) {
  return /^[\w][\w.-]*$/.test(name) && !name.includes('..');
}

function splitScope(raw) {
  return String(raw ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/** Valida un archivo ya leído. Devuelve la skill o lanza con la causa (se muestra en `skills ls`). */
export function validateSkill({ dirRole, fileName, text }) {
  const name = fileName.replace(/\.md$/i, '');
  if (!safeName(name)) throw new Error('nombre de archivo no válido (no puede salir de la carpeta)');
  const { header, body } = parseSkillText(text);
  if (!header.rol) throw new Error('la cabecera no declara rol');
  if (!SKILL_ROLES.includes(header.rol)) throw new Error(`rol desconocido "${header.rol}"`);
  if (header.rol !== dirRole) throw new Error(`el rol "${header.rol}" no coincide con la carpeta "${dirRole}"`);
  const scope = splitScope(header.alcance);
  if (!scope.length) throw new Error('la cabecera no declara alcance');
  if (scope.some((s) => s.split(/[\\/]/).includes('..'))) throw new Error('el alcance sale de la carpeta con ".."');
  const content = body.trim();
  if (!content) throw new Error('la skill está vacía');
  return { name, role: header.rol, scope, body: content };
}

/** Lee todas las skills del workspace. Nunca lanza: lo que falla va a `invalid` con su causa. */
export function readSkills(workspace) {
  const valid = [];
  const invalid = [];
  const root = skillsDir(workspace);
  let roleDirs;
  try {
    roleDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { valid, invalid };
  }
  for (const dirent of roleDirs) {
    if (!dirent.isDirectory() || !SKILL_ROLES.includes(dirent.name)) continue;
    const dir = path.join(root, dirent.name);
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
    } catch {
      continue;
    }
    for (const fileName of files) {
      const file = path.join(dir, fileName);
      const rel = path.posix.join('.silka/skills', dirent.name, fileName);
      // RS-05: un nombre que intente salir de la carpeta se rechaza sin leer el archivo.
      if (!safeName(fileName.replace(/\.md$/i, ''))) {
        invalid.push({ path: rel, reason: 'nombre de archivo no válido (no puede salir de la carpeta)' });
        continue;
      }
      try {
        const skill = validateSkill({ dirRole: dirent.name, fileName, text: fs.readFileSync(file, 'utf8') });
        valid.push({ ...skill, path: rel, bytes: Buffer.byteLength(skill.body, 'utf8') });
      } catch (error) {
        invalid.push({ path: rel, reason: error.message });
      }
    }
  }
  valid.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  return { valid, invalid };
}

function skillBlock(skill) {
  return `### ${skill.name} (${skill.path})\n${skill.body}\n\n`;
}

/**
 * Bloque que se antepone al encargo de una tarea: solo skills del rol de skill de la tarea cuyo
 * alcance coincide, dentro de SKILLS_BUDGET_BYTES. Lo que no cabe se cita por referencia.
 * Vacío si no hay nada aplicable o si algo falla (nunca impide lanzar).
 */
export function skillsPrefix(workspace, { taskRole, scope = [] } = {}) {
  return skillsPrefixForRole(workspace, skillRoleForTask(taskRole), scope);
}

/** Mismo bloque para un rol de skill directo (p. ej. `revisor` o `verificador` en la revisión). */
export function skillsPrefixForRole(workspace, role, scope = []) {
  try {
    if (!role) return '';
    const candidates = readSkills(workspace).valid.filter((skill) => skill.role === role);
    if (!candidates.length) return '';
    const { picked, rest } = selectByScope(
      candidates.map((skill) => ({ ...skill, tags: skill.scope, at: '' })),
      scope,
      { budget: SKILLS_BUDGET_BYTES, lineOf: (entry) => skillBlock(entry) },
    );
    if (!picked.length && !rest.length) return '';
    const lines = [`Skills del rol ${role} (silka), vigentes para este alcance:`, ''];
    for (const skill of picked) lines.push(skillBlock(skill).trimEnd(), '');
    if (rest.length) {
      lines.push(`Otras ${rest.length} skills no caben en el tope: .silka/skills/ (silka skills ls).`, '');
    }
    return `${lines.join('\n')}\n`;
  } catch {
    return '';
  }
}

/** silka skills ls [--json] [--workspace dir]: rol, alcance y tamaño; las inválidas con su causa. */
export function skillsCommand(argv, cwd = process.cwd()) {
  const [sub, ...rest] = argv;
  if (sub !== 'ls') throw new Error('Uso: silka skills ls [--json] [--workspace dir]');
  const wsIndex = rest.indexOf('--workspace');
  const ws = wsIndex >= 0 && rest[wsIndex + 1] ? rest[wsIndex + 1] : cwd;
  const { valid, invalid } = readSkills(ws);
  if (rest.includes('--json')) {
    const out = {
      valid: valid.map(({ name, role, scope, path: file, bytes }) => ({ name, role, scope, path: file, bytes })),
      invalid,
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }
  if (!valid.length && !invalid.length) console.log('sin skills en .silka/skills/');
  for (const skill of valid) {
    console.log(`${skill.role}\t${skill.scope.join(', ')}\t${skill.bytes} B\t${skill.path}`);
  }
  for (const item of invalid) console.log(`INVÁLIDA\t${item.path}\t${item.reason}`);
  return { valid, invalid };
}
