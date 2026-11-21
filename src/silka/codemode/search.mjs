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

/** Extrae bloques (comentario JSDoc + firma) del .d.ts. */
export function extractSignatureBlocks(source) {
  const lines = String(source).split(/\r?\n/);
  const blocks = [];
  let current = [];
  let inInterface = false;
  const flush = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push(text);
    current = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^export interface Silka\b/.test(trimmed) || /^export interface SilkaPlan/.test(trimmed)) {
      flush();
      inInterface = true;
      current.push(line);
      continue;
    }
    if (inInterface) {
      current.push(line);
      if (trimmed === '}') {
        flush();
        inInterface = false;
      }
      continue;
    }
    if (trimmed.startsWith('/**')) {
      flush();
      current.push(line);
      continue;
    }
    if (current.length && current[0].trim().startsWith('/**')) {
      current.push(line);
      if (trimmed.endsWith(';') || /^export declare const silka/.test(trimmed) || /^\w+\(/.test(trimmed)) {
        flush();
      }
      continue;
    }
    if (/^(export )?(type|interface) /.test(trimmed) || /^  \w+\(/.test(line)) {
      flush();
      current.push(line);
      if (trimmed.endsWith(';') || trimmed === '}') flush();
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
      const size = Buffer.byteLength(text, 'utf8');
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