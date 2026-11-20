import fs from 'node:fs';
import path from 'node:path';
import { withFileLock, writeAtomic } from './lock.mjs';
import { silkaConfigDir } from './paths.mjs';

export function originsFile() {
  return path.join(silkaConfigDir(), 'sessions.json');
}

export function readOrigins() {
  try {
    const parsed = JSON.parse(fs.readFileSync(originsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Nombres de cliente MCP → etiqueta corta (codex-mcp-client → codex, claude-code → claude). */
export function originLabel(name) {
  const raw = String(name || '').replace(/[\u0000-\u001f]/g, '').trim();
  const text = raw.toLowerCase();
  for (const known of ['claude', 'codex', 'cursor', 'opencode']) if (text.includes(known)) return known;
  return raw || 'tú';
}

export function rememberOrigin(sessionId, { from, depth, parentSessionId }) {
  if (!sessionId) return null;
  return withFileLock(path.join(silkaConfigDir(), 'sessions.lock'), () => {
    const all = readOrigins();
    const entry = {
      from: originLabel(from),
      depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
      at: new Date().toISOString(),
    };
    if (parentSessionId && parentSessionId !== sessionId) entry.parentSessionId = parentSessionId;
    all[sessionId] = entry;
    writeAtomic(originsFile(), `${JSON.stringify(all, null, 2)}\n`);
    return entry;
  });
}
