const SNIPPET_MAX = 6000;

export function truncateForRepair(text, ref) {
  const s = String(text ?? '');
  if (s.length <= SNIPPET_MAX) return s;
  return `${s.slice(0, SNIPPET_MAX)}\n…[salida recortada; log completo: ${ref}]`;
}

export function buildRepairMessage({ evidence, verifyRef }) {
  const parts = ['La verificación de Silka falló. Corrige y vuelve a entregar.', ''];
  for (const e of evidence || []) {
    if (!e.ok) {
      if (e.kind === 'verify' || e.type === 'cmd') {
        parts.push(`Comando: ${e.cmd}`);
        parts.push(`Código de salida: ${e.exitCode ?? '?'}`);
        if (e.logSnippet) {
          parts.push(truncateForRepair(e.logSnippet, e.ref));
        } else if (e.ref) {
          parts.push(`Ver salida en ${e.ref}`);
        }
      } else {
        parts.push(`Criterio ${e.type}: ${e.detail || e.pattern || e.path}`);
      }
      parts.push('');
    }
  }
  if (verifyRef) parts.push(`Log verify: ${verifyRef}`);
  return parts.join('\n').trim();
}