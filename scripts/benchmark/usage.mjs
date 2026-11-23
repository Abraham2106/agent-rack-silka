// Tokens del manager tal como los reporta el proveedor (TB-02). Nunca se estiman por caracteres:
// si la salida no trae uso, todo queda en null con fuente "sin dato" y el informe no calcula ahorro.
import { SIN_DATO } from '../../src/silka/metrics/fields.mjs';

export const USAGE_SOURCE = 'claude-cli:usage';

const EMPTY = Object.freeze({
  tokensIn: null,
  tokensOut: null,
  tokensCache: null,
  costUsd: null,
  sources: { tokensIn: SIN_DATO, tokensOut: SIN_DATO, tokensCache: SIN_DATO, costUsd: SIN_DATO },
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Busca el mensaje final con uso: objeto único (`--output-format json`) o lista (stream-json). */
function resultObject(parsed) {
  if (Array.isArray(parsed)) {
    const result = [...parsed].reverse().find((e) => e && typeof e === 'object' && e.type === 'result');
    return result ?? null;
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/**
 * Lee el uso del manager de la salida de `claude -p --output-format json`.
 * tokensIn suma entrada sin caché, escritura de caché y lectura de caché: es todo lo que el
 * manager procesó como entrada. tokensCache es solo la lectura de caché.
 */
export function managerUsageFromClaudeJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? '').trim());
  } catch {
    return { ...EMPTY, sources: { ...EMPTY.sources } };
  }
  const result = resultObject(parsed);
  const usage = result?.usage;
  if (!usage || typeof usage !== 'object') {
    return { ...EMPTY, sources: { ...EMPTY.sources } };
  }
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  if (input == null || output == null) {
    return { ...EMPTY, sources: { ...EMPTY.sources } };
  }
  const cacheWrite = num(usage.cache_creation_input_tokens) ?? 0;
  const cacheRead = num(usage.cache_read_input_tokens) ?? 0;
  const cost = num(result.total_cost_usd);
  return {
    tokensIn: input + cacheWrite + cacheRead,
    tokensOut: output,
    tokensCache: cacheRead,
    costUsd: cost,
    sources: {
      tokensIn: USAGE_SOURCE,
      tokensOut: USAGE_SOURCE,
      tokensCache: USAGE_SOURCE,
      costUsd: cost == null ? SIN_DATO : USAGE_SOURCE,
    },
  };
}

export const OPENCODE_USAGE_SOURCE = 'opencode:step_finish.tokens';

/**
 * Lee el uso del manager de `opencode run --format json` (un evento JSON por línea).
 * Cada evento `step_finish` trae el uso del proveedor en part.tokens ({input, output, reasoning,
 * cache: {read, write}}) y el costo en part.cost. Se suman los pasos del turno.
 * tokensIn = input + caché escrita + caché leída (mismo criterio que el camino de Claude);
 * tokensOut = output + reasoning (en la salida real el razonamiento viene aparte del output).
 * Si no hay ningún paso con uso, o un paso trae un campo que falta, el dato queda en null: sin dato.
 */
export function opencodeUsageFromJsonl(stdout) {
  const parts = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    if (event?.type === 'step_finish' && event.part?.tokens) parts.push(event.part);
  }
  const empty = { ...EMPTY, sources: { ...EMPTY.sources } };
  if (parts.length === 0) return empty;
  const sumOf = (pick) => {
    let total = 0;
    for (const p of parts) {
      const v = num(pick(p));
      if (v == null) return null;
      total += v;
    }
    return total;
  };
  const input = sumOf((p) => p.tokens.input);
  const output = sumOf((p) => p.tokens.output);
  const reasoning = sumOf((p) => p.tokens.reasoning);
  const cacheRead = sumOf((p) => p.tokens.cache?.read);
  const cacheWrite = sumOf((p) => p.tokens.cache?.write);
  const cost = sumOf((p) => p.cost);
  if (input == null || output == null || reasoning == null || cacheRead == null || cacheWrite == null) return empty;
  return {
    tokensIn: input + cacheWrite + cacheRead,
    tokensOut: output + reasoning,
    tokensCache: cacheRead,
    costUsd: cost,
    sources: {
      tokensIn: OPENCODE_USAGE_SOURCE,
      tokensOut: OPENCODE_USAGE_SOURCE,
      tokensCache: OPENCODE_USAGE_SOURCE,
      costUsd: cost == null ? SIN_DATO : OPENCODE_USAGE_SOURCE,
    },
  };
}
