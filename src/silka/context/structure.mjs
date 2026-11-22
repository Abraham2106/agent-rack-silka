import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '.silka', 'graphify-out']);

function walk(dir, root, depth, maxDepth, out, limit) {
  if (out.length >= limit || depth > maxDepth) return;
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  names.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of names) {
    if (SKIP.has(ent.name)) continue;
    const rel = path.relative(root, path.join(dir, ent.name)).replaceAll('\\', '/');
    out.push(`${ent.isDirectory() ? 'd' : 'f'} ${rel}`);
    if (out.length >= limit) return;
    if (ent.isDirectory()) walk(path.join(dir, ent.name), root, depth + 1, maxDepth, out, limit);
  }
}

/** Árbol compacto sin contenido de archivos (FR-CX-01). */
export function repoStructure(workspace, { maxDepth = 4, limit = 400 } = {}) {
  const root = path.resolve(workspace);
  const out = [];
  walk(root, root, 0, maxDepth, out, limit);
  return out.join('\n');
}