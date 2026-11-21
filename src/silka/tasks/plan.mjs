import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { validateTaskList } from './model.mjs';

export function planFromList(items) {
  return validateTaskList(items);
}

export function planFromFile(filePath, cwd = process.cwd()) {
  const abs = path.resolve(cwd, filePath);
  if (!fs.existsSync(abs)) {
    throw silkaError('E_NOT_FOUND', `No existe el plan: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (abs.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.tasks;
    return validateTaskList(list);
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return validateTaskList(parsed);
    if (Array.isArray(parsed?.tasks)) return validateTaskList(parsed.tasks);
  } catch { /* markdown u otro */ }
  const block = text.match(/```json\s*([\s\S]*?)```/i);
  if (block) {
    const parsed = JSON.parse(block[1]);
    const list = Array.isArray(parsed) ? parsed : parsed?.tasks;
    return validateTaskList(list);
  }
  throw silkaError('E_TASK_INVALID', 'Formato de plan no reconocido (usa .json o un bloque ```json).');
}