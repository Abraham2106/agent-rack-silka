import { charTokens } from '../codemode/token-metrics.mjs';
import { SIN_DATO } from './fields.mjs';

const EVENT_MAP = {
  codex: 'codex:turn.completed',
  opencode: 'opencode:step_finish',
  cursor: 'cursor:result',
};

/** Tokens reales del agente si los trae el evento; si no, null (nunca en silencio). */
export function tokensFromAgentReport(agent, event) {
  const src = EVENT_MAP[agent] || `${agent}:evento`;
  if (!event || typeof event !== 'object') {
    return {
      tokensIn: null,
      tokensOut: null,
      tokensCache: null,
      sources: { tokensIn: SIN_DATO, tokensOut: SIN_DATO, tokensCache: SIN_DATO },
    };
  }
  const usage = event.usage || event.tokens || event;
  const tokensIn = pickNumber(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'tokensIn']);
  const tokensOut = pickNumber(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'tokensOut']);
  const tokensCache = pickNumber(usage, ['cached_tokens', 'cacheRead', 'tokensCache']);
  return {
    tokensIn,
    tokensOut,
    tokensCache,
    sources: {
      tokensIn: tokensIn == null ? SIN_DATO : src,
      tokensOut: tokensOut == null ? SIN_DATO : src,
      tokensCache: tokensCache == null ? SIN_DATO : src,
    },
  };
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const n = Number(obj?.[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Estimación explícita (chars/4), nunca mezclada con medición real. */
export function estimateTokensFromText(text, field = 'tokensIn') {
  const n = charTokens(text);
  return {
  [field]: n,
    sources: { [field]: 'estimacion:chars/4' },
  };
}