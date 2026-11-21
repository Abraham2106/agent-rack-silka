import path from 'node:path';
import { createMergeService } from './service.mjs';

export function mergeList(workspace = process.cwd()) {
  const svc = createMergeService(path.resolve(workspace));
  const items = svc.queue();
  if (!items.length) {
    console.log('Cola de mezcla vacía.');
    return [];
  }
  for (const row of items) {
    console.log(`${row.position}\t${row.id}\t${row.step || '-'}\t${row.title}`);
  }
  return items;
}

export function mergeStatus(taskId, workspace = process.cwd()) {
  const svc = createMergeService(path.resolve(workspace));
  const row = svc.status(taskId);
  console.log(JSON.stringify(row, null, 2));
  return row;
}