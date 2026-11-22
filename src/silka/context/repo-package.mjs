import crypto from 'node:crypto';
import fs from 'node:fs';
import { redactSecrets } from '../redact.mjs';
import { writeAtomic } from '../lock.mjs';
import { repoInfo } from '../state.mjs';
import { readConventionExcerpts } from './conventions.mjs';
import { packagePath } from './paths.mjs';
import { repoStructure } from './structure.mjs';
import { verifyCommands } from './verify-commands.mjs';

export const PACKAGE_SECTION_ORDER = ['estructura', 'convenciones', 'verificacion'];

function packageSections(workspace) {
  return {
    estructura: repoStructure(workspace),
    convenciones: readConventionExcerpts(workspace) || '(sin AGENTS.md / CLAUDE.md / CONTRIBUTING.md)',
    verificacion: verifyCommands(workspace),
  };
}

function renderPackage(sections) {
  return PACKAGE_SECTION_ORDER
    .map((id) => `## ${id.charAt(0).toUpperCase() + id.slice(1)}\n${sections[id]}`)
    .join('\n\n');
}

export function repoPackageSha(workspace) {
  const info = repoInfo(workspace);
  return info?.head || 'no-git';
}

export function readRepoPackage(workspace, sha) {
  const file = packagePath(workspace, sha);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Construye una vez y cachea en `.silka/context/<sha>.md` (FR-CX-01). */
export function ensureRepoPackage(workspace, { sha } = {}) {
  const base = sha || repoPackageSha(workspace);
  const file = packagePath(workspace, base);
  const existing = readRepoPackage(workspace, base);
  if (existing) {
    return { sha: base, text: existing, path: file, cached: true };
  }
  const body = redactSecrets(renderPackage(packageSections(workspace)));
  writeAtomic(file, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  return { sha: base, text: body, path: file, cached: false, contentHash: digest };
}