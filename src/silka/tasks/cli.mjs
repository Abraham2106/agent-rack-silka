import path from 'node:path';
import { currentCommit } from './git.mjs';
import { createTaskManager } from './manager.mjs';
import { planDocumentFromFile } from '../integration/parse.mjs';
import { registerPlanInStore } from '../integration/runner.mjs';

export async function taskRunFromFile(planFile, opts = {}) {
  const workspace = path.resolve(opts.workspace || process.cwd());
  const doc = planDocumentFromFile(planFile, workspace);
  if (doc.plan) {
    registerPlanInStore(workspace, doc.plan, currentCommit(workspace));
  }
  const mgr = createTaskManager(workspace, { maxConcurrentTasks: opts.maxConcurrent });
  const launched = await mgr.launch(doc.tasks, {
    cause: 'cli',
    callHub: opts.callHub,
    manual: !opts.callHub,
    defaultAgent: opts.defaultAgent,
    defaultModel: opts.defaultModel,
  });
  console.log(JSON.stringify({ launched }, null, 2));
  return launched;
}

export function taskVerify(taskId, workspace = process.cwd()) {
  const mgr = createTaskManager(workspace);
  const card = mgr.verifyTask(taskId);
  console.log(JSON.stringify(card, null, 2));
  return card;
}

export function taskList(workspace = process.cwd()) {
  const mgr = createTaskManager(workspace);
  const tasks = mgr.list();
  if (!tasks.length) {
    console.log('Sin tareas en .silka/tasks-v1/');
    return [];
  }
  for (const t of tasks) {
    console.log(`${t.id}\t${t.state}\t${t.title}`);
  }
  return tasks;
}