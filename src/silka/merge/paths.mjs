import path from 'node:path';

export function mergeJournalPath(repoRoot) {
  return path.join(repoRoot, '.silka', 'merge-journal.jsonl');
}

export function mergeOwnerPath(repoRoot) {
  return path.join(repoRoot, '.silka', 'merge-owner.json');
}

export function mergeStatePath(repoRoot) {
  return path.join(repoRoot, '.silka', 'merge-state.json');
}