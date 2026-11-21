import path from 'node:path';

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = esc
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '[^/\\\\]');
  return new RegExp(`^${body}$`, 'i');
}

export function pathInScope(file, scopes) {
  const norm = file.replace(/\\/g, '/');
  for (const scope of scopes || []) {
    const s = scope.replace(/\\/g, '/');
    if (s.endsWith('/') && norm.startsWith(s)) return true;
    if (!s.includes('*') && !s.includes('?')) {
      if (norm === s || norm.startsWith(`${s}/`)) return true;
      continue;
    }
    if (globToRegex(s).test(norm)) return true;
  }
  return false;
}

export function partitionByScope(files, scopes) {
  const inScope = [];
  const outOfScope = [];
  for (const file of files || []) {
    const rel = file.replace(/\\/g, '/');
    if (pathInScope(rel, scopes)) inScope.push(rel);
    else outOfScope.push(rel);
  }
  return { inScope, outOfScope };
}