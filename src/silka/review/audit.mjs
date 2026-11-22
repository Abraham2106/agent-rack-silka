import fs from 'node:fs';
import path from 'node:path';

function auditFile(repoRoot) {
  return path.join(repoRoot, '.silka', 'reviews.jsonl');
}

/** FR-RV-06: auditoría append-only de decisiones de revisión. */
export function appendReviewAudit(repoRoot, row) {
  const file = auditFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    ...row,
  };
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export function readReviewAudit(repoRoot) {
  const file = auditFile(repoRoot);
  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}