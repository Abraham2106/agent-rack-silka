import path from 'node:path';
import { createTaskManager } from './manager.mjs';
import { planFromFile } from './plan.mjs';

export async function taskRunFromFile(planFile, opts = {}) {
  const workspace = path.resolve(opts.workspace || process.cwd());
  const plan = planFromFile(planFile, workspace);
  const mgr = createTaskManager(workspace, { maxConcurrentTasks: opts.maxConcurrent });
  const launched = await mgr.launch(plan, {
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