import { gitRun } from '../tasks/git.mjs';
import { openJournalSteps } from './journal.mjs';
import { refSha } from './git-merge.mjs';
import { assertFencing } from './owner.mjs';
import { clearMergeRuntime, readMergeRuntime } from './state.mjs';

/** Reanuda o limpia pasos a medias según el diario (FR-MQ-07). */
export function recoverIncompleteMerge(repoRoot, fencingToken) {
  assertFencing(repoRoot, fencingToken);
  const open = openJournalSteps(repoRoot);
  for (const row of open) {
    if (row.step === 'rebase' && row.worktreePath) {
      gitRun(row.worktreePath, ['rebase', '--abort'], { repoRoot });
    }
    if (row.step === 'fast_forward' && row.targetRef && row.expectedOld && row.expectedNew) {
      try {
        const now = refSha(repoRoot, row.targetRef);
        if (now === row.expectedNew) {
          /* ya aplicado */
        }
      } catch {
        /* se reintentará en el ciclo */
      }
    }
  }
  const rt = readMergeRuntime(repoRoot);
  if (rt && !open.some((o) => o.taskId === rt.taskId)) {
    clearMergeRuntime(repoRoot);
  }
}