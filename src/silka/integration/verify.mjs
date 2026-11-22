import { runAcceptCriteria } from '../tasks/accept.mjs';
import { assertVerifyDeclared, runVerifyWithEvidence } from '../tasks/verify.mjs';
import { runSetupWithEvidence, setupForIntegration } from '../tasks/setup.mjs';

export function runIntegrationChecks(repoRoot, cwd, integration, { timeoutMs = 120_000, taskId = 'integration' } = {}) {
  if (!integration) return { ok: true, evidence: [] };
  let evidence = [];
  let ok = true;

  const setupSpec = setupForIntegration(integration, repoRoot, cwd);
  const sr = runSetupWithEvidence(repoRoot, taskId, cwd, setupSpec, {
    timeoutMs,
    repoRootForLink: repoRoot,
  });
  evidence = evidence.concat(sr.items);
  ok = ok && sr.ok;

  const verifyCmds = assertVerifyDeclared(integration.verify);
  if (ok && verifyCmds.length) {
    const vr = runVerifyWithEvidence(repoRoot, taskId, cwd, verifyCmds, { timeoutMs });
    evidence = vr.items;
    ok = vr.ok;
  }
  if (ok && (integration.accept || []).length) {
    const ar = runAcceptCriteria(repoRoot, taskId, cwd, integration.accept, { timeoutMs });
    evidence = evidence.concat(ar.items);
    ok = ok && ar.ok;
  }
  return { ok, evidence };
}