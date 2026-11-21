import path from 'node:path';
import { partitionByScope } from '../tasks/scope.mjs';

/** Encargo con punteros, sin pegar contenido (FR-CX-03). */
export function assignmentPointers(task, workspace) {
  const lines = [];
  const title = String(task?.title || task?.prompt || 'tarea').trim();
  lines.push(`Título: ${title}`);
  if (task?.deliver) lines.push(`Entregar: ${String(task.deliver).trim()}`);
  if (task?.verify) lines.push(`Verificar: ${String(task.verify).trim()}`);
  const scope = task?.scope;
  const scopes = scope ? (Array.isArray(scope) ? scope : [scope]) : [];
  if (scopes.length) {
    lines.push('Ámbito:');
    for (const s of scopes) lines.push(`- ${s}`);
  }
  const files = Array.isArray(task?.files) ? task.files : [];
  if (files.length && scopes.length) {
    const { inScope } = partitionByScope(files.map((f) => path.relative(workspace, f).replaceAll('\\', '/')), scopes);
    for (const file of inScope.slice(0, 24)) {
      lines.push(`- ${file} — en ámbito`);
    }
  }
  if (task?.prompt && task.prompt !== title) {
    lines.push(`Nota: ${String(task.prompt).trim().split('\n')[0]}`);
  }
  return lines.join('\n');
}