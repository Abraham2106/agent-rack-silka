import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEARCH_MAX_BYTES } from './limits.mjs';
import { SILKA_API_VERSION } from './version.mjs';

const DTS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'silka.d.ts');

function tokenizeQuery(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter((w) => w.length > 1);
}

function scoreBlock(block, words) {
  if (!words.length) return 1;
  const hay = block.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (hay.includes(word)) score += 1;
  }
  return score;
}

function braceDelta(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') delta += 1;
    if (ch === '}') delta -= 1;
  }
  return delta;
}

/** Extrae bloques (comentario JSDoc + firma o cuerpo completo de interface/type) del .d.ts. */
export function extractSignatureBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const blocks = [];
  let current = [];
  /** @type {'interface' | 'type' | null} */
  let mode = null;
  let depth = 0;

  const flush = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push(text);
    current = [];
    mode = null;
    depth = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!mode) {
      if (/^export interface \w+/.test(trimmed)) {
        flush();
        mode = 'interface';
        current.push(line);
        depth = braceDelta(line);
        if (depth <= 0) flush();
        continue;
      }
      if (/^export type \w+/.test(trimmed)) {
        flush();
        mode = 'type';
        current.push(line);
        depth = braceDelta(line);
        if (trimmed.endsWith(';') && depth <= 0) flush();
        continue;
      }
      if (/^export declare const/.test(trimmed)) {
        flush();
        blocks.push(trimmed);
        continue;
      }
      continue;
    }

    current.push(line);
    depth += braceDelta(line);
    if (mode === 'type' && trimmed.endsWith(';') && depth <= 0) {
      flush();
    } else if (mode === 'interface' && depth <= 0) {
      flush();
    }
  }
  flush();
  return blocks;
}

export function searchSignatures(query, { source = fs.readFileSync(DTS_PATH, 'utf8') } = {}) {
  const words = tokenizeQuery(query);
  const blocks = extractSignatureBlocks(source)
    .map((text) => ({ text, score: scoreBlock(text, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let bytes = 0;
  for (const item of blocks) {
    const size = Buffer.byteLength(item.text, 'utf8') + (picked.length ? 2 : 0);
    if (bytes + size > SEARCH_MAX_BYTES) break;
    picked.push(item.text);
    bytes += size;
  }

  if (!picked.length && words.length) {
    const fallback = extractSignatureBlocks(source).slice(0, 3);
    for (const text of fallback) {
      const size = Buffer.byteLength(text, 'utf8') + (picked.length ? 2 : 0);
      if (bytes + size > SEARCH_MAX_BYTES) break;
      picked.push(text);
      bytes += size;
    }
  }

  return {
    version: SILKA_API_VERSION,
    query: String(query ?? ''),
    fragments: picked.join('\n\n'),
    bytes,
  };
}