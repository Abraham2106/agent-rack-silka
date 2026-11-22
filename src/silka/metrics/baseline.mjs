import { charTokens } from '../codemode/token-metrics.mjs';
import { measureNfrTok01 } from '../codemode/token-metrics.mjs';

/**
 * Tabla comparable para N PRs (FR-ME-04 / T-ME-02).
 * `cases` son escenarios con tokens medidos o null (sin dato).
 */
export function baselineComparisonTable(cases, { withContext = true } = {}) {
  const tok = measureNfrTok01();
  const rows = (cases || []).map((item, index) => {
    const legacy = item.legacyTokens ?? null;
    const optimized = withContext
      ? (item.contextTokens ?? item.codeModeTokens ?? null)
      : (item.codeModeTokens ?? null);
    const verifyBase = item.verifyBaseline ?? null;
    const verifyRun = withContext ? (item.verifyWithContext ?? item.verifyRun ?? null) : (item.verifyRun ?? null);
    return {
      pr: item.id || `PR-${index + 1}`,
      legacyTokens: legacy,
      runTokens: optimized,
      tokenDelta: legacy != null && optimized != null ? legacy - optimized : null,
      verifyBaseline: verifyBase,
      verifyRun,
      verifyOk: verifyBase == null || verifyRun == null ? null : verifyRun >= verifyBase,
    };
  });
  const savings = rows.filter((r) => r.tokenDelta != null);
  const avgSave = savings.length
    ? savings.reduce((n, r) => n + r.tokenDelta, 0) / savings.length
    : null;
  return {
    mode: withContext ? 'con-paquete' : 'sin-paquete',
    nfrTok01: tok,
    estimatedContextOverheadTokens: charTokens('context-package'),
    rows,
    avgTokenReduction: avgSave,
  };
}