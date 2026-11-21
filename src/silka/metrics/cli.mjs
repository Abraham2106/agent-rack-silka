import { aggregateAgentStats } from './stats.mjs';
import { readMetrics } from './read.mjs';
import { baselineComparisonTable } from './baseline.mjs';

export function metricsCommand(argv, workspace) {
  const sub = argv[0];
  const ws = workspace || process.cwd();
  if (!sub || sub === 'ls' || sub === 'list') {
    const rows = readMetrics(ws).slice(-20);
    if (!rows.length) {
      console.log('sin métricas en .silka/metrics.jsonl');
      return;
    }
    for (const row of rows) {
      console.log(`${row.at} ${row.agent} ${row.model || '-'} in=${row.tokensIn} src=${row.sources?.tokensIn}`);
    }
    return;
  }
  if (sub === 'stats') {
    const agent = argv[1];
    const model = argv[2];
    console.log(JSON.stringify(aggregateAgentStats(ws, { agent, model }), null, 2));
    return;
  }
  if (sub === 'baseline') {
    const n = Number(argv[1]) > 0 ? Number(argv[1]) : 5;
    const cases = Array.from({ length: n }, (_, i) => ({
      id: `pr-${i + 1}`,
      legacyTokens: 120_000 + i * 1000,
      contextTokens: 40_000 + i * 500,
      verifyBaseline: 0.9,
      verifyWithContext: 0.92,
    }));
    console.log(JSON.stringify(baselineComparisonTable(cases), null, 2));
    return;
  }
  throw new Error('Uso: silka metrics [ls|stats <agente> [modelo]|baseline [N]]');
}