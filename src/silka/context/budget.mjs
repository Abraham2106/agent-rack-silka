import { storeContextBody } from './ref-store.mjs';

/**
 * Recorta por secciones enteras (FR-CX-05). Las de menor prioridad primero.
 * @param {{ id: string, title: string, body: string, priority: number }[]} sections mayor = más importante
 */
export function applySectionBudget(workspace, sections, budgetBytes) {
  const ordered = [...sections].sort((a, b) => a.priority - b.priority);
  let total = ordered.reduce((n, s) => n + Buffer.byteLength(s.body, 'utf8'), 0);
  const dropped = [];
  const kept = [...ordered];
  while (total > budgetBytes && kept.length > 1) {
    const victim = kept.shift();
    dropped.push(victim);
    total = kept.reduce((n, s) => n + Buffer.byteLength(s.body, 'utf8'), 0);
  }
  const pointer = dropped.length
    ? storeContextBody(workspace, dropped.map((s) => `## ${s.title}\n${s.body}`).join('\n\n'))
    : null;
  const bodies = kept.sort((a, b) => b.priority - a.priority);
  const lines = bodies.map((s) => `## ${s.title}\n${s.body}`);
  if (pointer) {
    lines.push(`## Contenido omitido\nRecupera la versión completa con silka.get('${pointer.ref}') (${pointer.bytes} bytes).`);
  }
  return {
    text: lines.join('\n\n'),
    dropped: dropped.map((s) => s.id),
    fullRef: pointer?.ref ?? null,
    bytes: Buffer.byteLength(lines.join('\n\n'), 'utf8'),
  };
}