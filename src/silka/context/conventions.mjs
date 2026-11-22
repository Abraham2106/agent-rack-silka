import fs from 'node:fs';
import path from 'node:path';

const FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md'];

/** Cita convenciones del repo, sin generar texto nuevo (SEC-11). */
export function readConventionExcerpts(workspace, { maxBytes = 24_000 } = {}) {
  const root = path.resolve(workspace);
  const parts = [];
  for (const name of FILES) {
    const file = path.join(root, name);
    try {
      const body = fs.readFileSync(file, 'utf8').trim();
      if (!body) continue;
      const slice = body.length > maxBytes ? `${body.slice(0, maxBytes)}\n…` : body;
      parts.push(`### ${name}\n${slice}`);
    } catch {
      /* no existe */
    }
  }
  return parts.join('\n\n');
}