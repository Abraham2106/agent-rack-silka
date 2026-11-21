import { partitionByScope } from './scope.mjs';
import { assessRisk } from './risk.mjs';

/** FR-TK-05: ficha con diff de git, verify y riesgo. */
export function buildDeliveryCard(task, { diff, verifyOk, verifyRef, agentNotes } = {}) {
  const { inScope, outOfScope } = partitionByScope(diff?.files || [], task.scope);
  const diffLines = (Number(diff?.added) || 0) + (Number(diff?.removed) || 0);
  const risk = assessRisk({
    verifyOk,
    files: diff?.files,
    outOfScope,
    diffLines,
  });
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    declared: task.deliver,
    agentNotes: agentNotes || '',
    files: inScope,
    filesAll: diff?.files || [],
    outOfScope,
    verify: {
      ok: verifyOk,
      ref: verifyRef,
    },
    diff: {
      added: diff?.added ?? 0,
      removed: diff?.removed ?? 0,
      summary: diff?.statText || '',
    },
    openQuestions: task.openQuestions || [],
    risk: risk.level,
    riskDetail: risk,
    gates: verifyOk ? 'pass' : 'fail',
    version: task.version,
    baseCommit: task.baseCommit,
    worktreePath: task.worktreePath,
  };
}