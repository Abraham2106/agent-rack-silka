import { createIntegrationService } from './service.mjs';

export function planStatus(planId, workspace = process.cwd()) {
  const svc = createIntegrationService(workspace);
  const status = svc.planStatus(planId);
  console.log(JSON.stringify(status, null, 2));
  return status;
}