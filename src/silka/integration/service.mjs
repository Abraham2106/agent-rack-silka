import { getTask } from '../tasks/store.mjs';
import { getPlan, listPlans } from './store.mjs';
import { integrationBlockedReason } from './runner.mjs';

export function buildPlanStatus(repoRoot, planId) {
  const plan = getPlan(repoRoot, planId);
  if (!plan) return null;
  const waves = (plan.waves || []).map((taskIds, index) => {
    const ws = plan.wavesState?.[index] || { status: 'pending' };
    const tasks = taskIds.map((id) => {
      const t = getTask(repoRoot, id);
      return {
        id,
        state: t?.state || 'desconocida',
        wave: index,
        mergeCommit: t?.mergeCommit || null,
        blockedReason: integrationBlockedReason(repoRoot, t) || t?.blockedReason || null,
      };
    });
    return {
      index,
      status: ws.status,
      taskIds,
      tasks,
      evidence: ws.evidence || null,
      culpritTaskId: ws.culpritTaskId || null,
      waveCard: ws.waveCard || null,
      blockedReason: ws.blockedReason || null,
      mergeCommits: ws.mergeCommits || [],
      passedAtCommit: ws.passedAtCommit || null,
    };
  });
  return {
    id: plan.id,
    integration: plan.integration,
    destBaseline: plan.destBaseline,
    waves,
  };
}

export function createIntegrationService(workspace) {
  return {
    planStatus(planId) {
      const status = buildPlanStatus(workspace, planId);
      if (!status) throw new Error(`Plan no encontrado: ${planId}`);
      return status;
    },
    listPlans() {
      return listPlans(workspace).map((p) => p.id);
    },
  };
}