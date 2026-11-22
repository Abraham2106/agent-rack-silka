import { readMetrics } from './read.mjs';

function median(nums) {
  const list = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

export function filterMetrics(rows, { agent, model } = {}) {
  return rows.filter((row) => {
    if (agent && row.agent !== agent) return false;
    if (model && row.model !== model) return false;
    return true;
  });
}

/** FR-ME-03: éxito a la primera, tokens y tiempo medianos. */
export function aggregateAgentStats(workspace, { agent, model } = {}) {
  const rows = filterMetrics(readMetrics(workspace), { agent, model });
  const firstPass = rows.filter((r) => r.firstPass === true).length;
  const verified = rows.filter((r) => r.verify === true || r.verify === 'pass').length;
  const tokensIn = rows.map((r) => r.tokensIn);
  const duration = rows.map((r) => r.durationMs);
  return {
    agent: agent || '*',
    model: model || '*',
    samples: rows.length,
    firstPassRate: rows.length ? firstPass / rows.length : null,
    verifyRate: rows.length ? verified / rows.length : null,
    medianTokensIn: median(tokensIn),
    medianDurationMs: median(duration),
  };
}