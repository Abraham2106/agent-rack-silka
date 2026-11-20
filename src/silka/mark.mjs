import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { originLabel } from './origin.mjs';
import { silkaConfigDir } from './paths.mjs';

const MARK = /^\[silka depth=(\d+) from=([^\]]*) nonce=([a-f0-9]{32})\]\s*/;
const ANY_MARK = /^\[silka depth=\d+ from=[^\]]*\]\s*/;

export function markSecretFile() {
  return path.join(silkaConfigDir(), 'mark.secret');
}

/** Secreto del hub. Sin él, una marca en el prompt del usuario no cuenta. */
export function readMarkSecret() {
  const file = markSecretFile();
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(text)) return text;
  } catch { /* se crea abajo */ }
  const secret = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, `${secret}\n`, { flag: 'wx', mode: 0o600 });
    return secret;
  } catch {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(text)) return text;
    throw new Error('No pude leer el secreto de la marca silka.');
  }
}

export function sanitizeFrom(value) {
  const clean = String(value ?? '').replace(/[\u0000-\u001f]/g, '').replace(/[\[\]]/g, '').trim();
  return originLabel(clean);
}

/** Solo acepta la marca si el nonce es el del hub. Si no, el texto queda intacto. */
export function readSilkaMark(text, secret = readMarkSecret()) {
  const raw = String(text ?? '');
  const match = raw.match(MARK);
  if (!match || match[3] !== secret) return { prompt: raw, depth: null, from: null };
  return {
    prompt: raw.slice(match[0].length),
    depth: Number(match[1]),
    from: sanitizeFrom(match[2]),
  };
}

export function stripSilkaMark(text) {
  return String(text ?? '').replace(ANY_MARK, '');
}

export function stampPrompt(prompt, depth, from, secret = readMarkSecret()) {
  const clean = stripSilkaMark(prompt);
  const n = Number.isFinite(Number(depth)) ? Math.max(0, Math.floor(Number(depth))) : 0;
  return `[silka depth=${n} from=${sanitizeFrom(from)} nonce=${secret}] ${clean}`;
}
