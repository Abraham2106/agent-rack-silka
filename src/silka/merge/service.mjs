import { silkaError } from '../codemode/errors.mjs';
import { findGitRoot } from '../tasks/git.mjs';
import { listMergeQueue, mergeTaskStatus } from './queue.mjs';

export function createMergeService(workspace) {
  const repoRoot = findGitRoot(workspace) || workspace;
  return {
    queue() {
      return listMergeQueue(repoRoot);
    },
    status(taskId) {
      const row = mergeTaskStatus(repoRoot, taskId);
      if (!row) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
      return row;
    },
  };
}