import path from 'node:path';
import { createReviewService } from './service.mjs';

export function reviewList(workspace = process.cwd()) {
  const svc = createReviewService(path.resolve(workspace), { actor: 'human' });
  const items = svc.inbox();
  if (!items.length) {
    console.log('Bandeja vacía.');
    return [];
  }
  for (const row of items) {
    console.log(`${row.id}\t${row.risk}\t${row.gates}\tv${row.version}\t${row.title}`);
  }
  return items;
}

export function reviewApprove(taskId, workspace = process.cwd(), opts = {}) {
  const svc = createReviewService(path.resolve(workspace), { actor: 'human' });
  const version = Number(opts.version);
  const res = svc.approve(taskId, { version });
  console.log(JSON.stringify(res, null, 2));
  return res;
}

export async function reviewReject(taskId, note, workspace = process.cwd(), opts = {}) {
  const svc = createReviewService(path.resolve(workspace), { actor: 'human', callHub: opts.callHub });
  const version = Number(opts.version);
  const res = await svc.reject(taskId, note, { version });
  console.log(JSON.stringify({ state: res.task?.state, noop: res.noop }, null, 2));
  return res;
}

export function reviewDiscard(taskId, workspace = process.cwd(), opts = {}) {
  const svc = createReviewService(path.resolve(workspace), { actor: 'human' });
  const version = Number(opts.version);
  const res = svc.discard(taskId, { version });
  console.log(JSON.stringify(res, null, 2));
  return res;
}