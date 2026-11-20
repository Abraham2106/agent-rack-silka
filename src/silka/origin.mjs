import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function originsFile() {
  return path.join(os.homedir(), '.config', 'silka', 'sessions.json');
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
  const text = String(name || '').toLowerCase();
  for (const known of ['claude', 'codex', 'cursor', 'opencode']) if (text.includes(known)) return known;
  return String(name || 'tú');
}

export function rememberOrigin(sessionId, { from, depth, parentSessionId }) {
  if (!sessionId) return null;
  const all = readOrigins();
  const entry = {
    from: originLabel(from),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    at: new Date().toISOString(),
  };
  if (parentSessionId && parentSessionId !== sessionId) entry.parentSessionId = parentSessionId;
  all[sessionId] = entry;
  const file = originsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  return entry;
}
