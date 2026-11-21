import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../redact.mjs';
import { silkaDir } from '../state.mjs';
import { withFileLock } from '../lock.mjs';
import { METRIC_FIELDS, SIN_DATO, withSources } from './fields.mjs';
import { tokensFromAgentReport } from './tokens.mjs';

export function metricsFile(workspace) {
  return path.join(silkaDir(workspace), 'metrics.jsonl');
}

function normalizeRecord(input) {
  const base = {
    id: String(input.id || ''),
    agent: String(input.agent || ''),
    model: input.model == null ? null : String(input.model),
    at: input.at || new Date().toISOString(),
  };
  const values = {};
  const sources = { ...(input.sources || {}) };
  for (const key of METRIC_FIELDS) {
    values[key] = input[key] ?? null;
    if (!sources[key]) sources[key] = values[key] == null ? SIN_DATO : sources[key];
  }
  const usage = tokensFromAgentReport(base.agent, input.usage);
  for (const key of ['tokensIn', 'tokensOut', 'tokensCache']) {
    if (values[key] == null && usage[key] != null) {
      values[key] = usage[key];
      sources[key] = usage.sources[key];
    }
  }
  return { ...base, ...withSources(values, sources) };
}

export function buildTaskMetric(input) {
  return normalizeRecord(input);
}

export function appendMetric(workspace, record) {
  const row = buildTaskMetric(record);
  const line = `${redactSecrets(JSON.stringify(row))}\n`;
  const file = metricsFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (Buffer.byteLength(line, 'utf8') > 4096) {
    return withFileLock(path.join(silkaDir(workspace), '.metrics.lock'), () => {
      fs.appendFileSync(file, line);
    });
  }
  fs.appendFileSync(file, line);
  return row;
}