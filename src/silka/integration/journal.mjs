import fs from 'node:fs';
import path from 'node:path';

function journalPath(repoRoot) {
  return path.join(repoRoot, '.silka', 'tasks-v1', 'integration-journal.jsonl');
}

export function appendIntegrationJournal(repoRoot, row) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`;
  const file = journalPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line);
  return row;
}

export function readIntegrationJournal(repoRoot) {
  const file = journalPath(repoRoot);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function lastOpenIntegrationRun(repoRoot, planId, waveIndex) {
  const entries = readIntegrationJournal(repoRoot).filter(
    (e) => e.planId === planId && e.waveIndex === waveIndex,
  );
  let runId = null;
  let phase = null;
  for (const row of entries) {
    if (row.kind === 'run_start') {
      runId = row.runId;
      phase = 'running';
    }
    if (row.kind === 'run_done' && row.runId === runId) {
      runId = null;
      phase = null;
    }
    if (row.kind === 'culprit_start' && !runId) {
      runId = row.runId;
      phase = 'culprit';
    }
    if (row.kind === 'culprit_done' && row.runId === runId) {
      runId = null;
      phase = null;
    }
  }
  return { runId, phase, entries };
}