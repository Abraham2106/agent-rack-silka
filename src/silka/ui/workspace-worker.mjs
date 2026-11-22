// Hilo aparte para el estado de los workspaces (git, conflictos). En el hilo del TUI,
// estos `git` síncronos congelaban teclado y repintado ~1 s en cada ciclo.
import { parentPort } from 'node:worker_threads';
import { matchTaskSession, refreshConflicts, samePath, withGitCache, workspaceReport } from '../state.mjs';

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Misma lógica que antes vivía en el ciclo del TUI; también se usa sin worker. */
export function scanWorkspaces({ dirs, sessions, selectedWorkspace }) {
  const hot = new Set();
  let board = null;
  const fresh = Date.now() - SIX_HOURS;
  withGitCache(() => {
    for (const dir of dirs) {
      try {
        refreshConflicts(dir, sessions);
        const report = workspaceReport(dir);
        if (selectedWorkspace && samePath(selectedWorkspace, dir)) board = report;
        for (const conflict of report.conflicts) {
          if (conflict.resolved || Date.parse(conflict.at) < fresh) continue;
          for (const taskId of conflict.taskIds || []) {
            const task = report.tasks.find((item) => item.id === taskId);
            const session = task ? matchTaskSession({ ...task, workspace: dir }, sessions) : null;
            if (session) hot.add(session.sessionId);
          }
        }
      } catch { /* un workspace sin estado no frena el tablero */ }
    }
  });
  return { hot: [...hot], board, clear: !dirs.length };
}

parentPort?.on('message', (job) => {
  let result;
  try {
    result = { id: job.id, ...scanWorkspaces(job) };
  } catch (err) {
    result = { id: job.id, error: err instanceof Error ? err.message : String(err) };
  }
  // El tablero viaja por structured clone; si algo no se puede clonar, se manda sin él.
  try {
    parentPort.postMessage(result);
  } catch {
    parentPort.postMessage({ ...result, board: result.board ? JSON.parse(JSON.stringify(result.board)) : null });
  }
});
