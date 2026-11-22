import crypto from 'node:crypto';
import { mutateTaskStore, readTaskStore } from '../tasks/store.mjs';

export function newPlanId() {
  return `pl-${crypto.randomBytes(4).toString('hex')}`;
}

export function listPlans(repoRoot) {
  return readTaskStore(repoRoot).plans || [];
}

export function getPlan(repoRoot, planId) {
  return listPlans(repoRoot).find((p) => p.id === planId) || null;
}

export function mutatePlanStore(repoRoot, mutator) {
  return mutateTaskStore(repoRoot, (store) => {
    store.plans = store.plans || [];
    const next = mutator(store.plans) ?? store.plans;
    store.plans = next;
    return store;
  });
}

export function upsertPlan(repoRoot, plan) {
  return mutatePlanStore(repoRoot, (plans) => {
    const idx = plans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) plans[idx] = plan;
    else plans.push(plan);
    return plans;
  });
}

export function waveState(plan, waveIndex) {
  plan.wavesState = plan.wavesState || [];
  while (plan.wavesState.length <= waveIndex) {
    plan.wavesState.push({
      index: plan.wavesState.length,
      status: 'pending',
      mergeCommits: [],
      evidence: null,
      culpritTaskId: null,
      waveCard: null,
      blockedReason: null,
    });
  }
  return plan.wavesState[waveIndex];
}