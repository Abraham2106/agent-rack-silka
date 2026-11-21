import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { parsePlanDocument } from '../integration/parse.mjs';

export function planFromList(items, repoRoot) {
  const parsed = parsePlanDocument(items, repoRoot ? { repoRoot } : {});
  return parsed.tasks;
}

export function planFromFile(filePath, cwd = process.cwd()) {
  const abs = path.resolve(cwd, filePath);
  if (!fs.existsSync(abs)) {
    throw silkaError('E_NOT_FOUND', `No existe el plan: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (abs.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    return parsePlanDocument(parsed, { repoRoot: path.resolve(cwd) }).tasks;
  }
  try {
    const parsed = JSON.parse(text);
    return parsePlanDocument(parsed, { repoRoot: path.resolve(cwd) }).tasks;
  } catch { /* markdown u otro */ }
  const block = text.match(/```json\s*([\s\S]*?)```/i);
  if (block) {
    const parsed = JSON.parse(block[1]);
    return parsePlanDocument(parsed, { repoRoot: path.resolve(cwd) }).tasks;
  }
  throw silkaError('E_TASK_INVALID', 'Formato de plan no reconocido (usa .json o un bloque ```json).');
}