import { escapeAgentText } from '../review/escape.mjs';
import { partitionByScope } from './scope.mjs';
import { assessRisk } from './risk.mjs';

/** FR-TK-05: ficha con diff de git, evidence y riesgo; agentSays no afecta gates. */
export function buildDeliveryCard(task, {
  diff,
  evidence,
  verifyRef,
  agentSays,
  verifySource,
} = {}) {
  const { inScope, outOfScope } = partitionByScope(diff?.files || [], task.scope);
  const diffLines = (Number(diff?.added) || 0) + (Number(diff?.removed) || 0);
  const list = evidence || [];
  const verifyItems = list.filter((e) => e.kind === 'verify');
  const acceptItems = list.filter((e) => e.kind === 'accept');
  const verifyOk = verifyItems.length ? verifyItems.every((e) => e.ok) : true;
  const acceptOk = acceptItems.length ? acceptItems.every((e) => e.ok) : true;
  // Un setup fallido también reprueba: antes la ficha salía "pass" sin haber verificado nada,
  // porque el verify ni se corría y solo se miraban verify y accept.
  const setupOk = list.filter((e) => e.kind === 'setup').every((e) => e.ok);
  const allOk = setupOk && verifyOk && acceptOk;
  const risk = assessRisk({
    verifyOk: allOk,
    files: diff?.files,
    outOfScope,
    diffLines,
    allowNoVerify: task.allowNoVerify,
  });
  const notes = escapeAgentText(agentSays || '');
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    declared: task.deliver,
    agentSays: notes,
    agentSaysFrom: 'agente',
    agentNotes: notes,
    evidence: list,
    verifySource: verifySource || task.verifySource || 'declarado',
    files: inScope,
    filesAll: diff?.files || [],
    outOfScope,
    verify: {
      ok: allOk,
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
    gates: allOk ? 'pass' : 'fail',
    version: task.version,
    baseCommit: task.baseCommit,
    worktreePath: task.worktreePath,
  };
}