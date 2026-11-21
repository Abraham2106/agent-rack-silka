import { formatBlock } from '../state.mjs';
import { applySectionBudget } from './budget.mjs';
import { assignmentPointers } from './pointers.mjs';
import { ensureRepoPackage } from './repo-package.mjs';
import { resolveContextProviders } from './providers.mjs';

export const ASSEMBLY_ORDER = ['paquete', 'convenciones', 'estado', 'encargo'];

function extractSection(text, name) {
  const re = new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const m = re.exec(String(text || ''));
  return m ? m[1].trim() : '';
}

function packageWithoutConventions(text) {
  const estructura = extractSection(text, 'Estructura');
  const verificacion = extractSection(text, 'Verificacion');
  const chunks = [];
  if (estructura) chunks.push(`## Estructura\n${estructura}`);
  if (verificacion) chunks.push(`## Verificacion\n${verificacion}`);
  return chunks.join('\n\n').trim();
}

/**
 * Orden estable: paquete → convenciones → estado → encargo (FR-CX-02).
 */
export function assembleTaskContext(workspace, task, {
  budgetBytes = 48_000,
  providers = [],
  sha,
} = {}) {
  const pkg = ensureRepoPackage(workspace, { sha });
  const conventionsBody = extractSection(pkg.text, 'Convenciones') || '(sin convenciones)';
  const packageBody = packageWithoutConventions(pkg.text) || pkg.text;
  const stateBody = formatBlock(workspace, { excludeId: task?.id });
  const encargoBody = assignmentPointers(task || {}, workspace);
  const providerBits = resolveContextProviders(providers)
    .map((p) => p.extra(workspace))
    .filter(Boolean)
    .join('\n\n');

  const sections = [
    { id: 'paquete', title: 'Paquete de repo', body: packageBody, priority: 2 },
    { id: 'convenciones', title: 'Convenciones', body: conventionsBody, priority: 3 },
    { id: 'estado', title: 'Estado', body: stateBody, priority: 4 },
    { id: 'encargo', title: 'Encargo', body: encargoBody, priority: 5 },
  ];
  if (providerBits) {
    sections.splice(2, 0, { id: 'grafo', title: 'Contexto extra', body: providerBits, priority: 1 });
  }
  const budgeted = applySectionBudget(workspace, sections, budgetBytes);
  return {
    sha: pkg.sha,
    packagePath: pkg.path,
    text: budgeted.text,
    bytes: budgeted.bytes,
    fullRef: budgeted.fullRef,
    droppedSections: budgeted.dropped,
    assemblyOrder: ASSEMBLY_ORDER,
  };
}