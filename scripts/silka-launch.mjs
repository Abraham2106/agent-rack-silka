// Lanza un lote de tareas con el código actual de Silka (sin pasar por el bridge MCP, que puede
// llevar código viejo si se arrancó antes de un cambio), con tope de tareas simultáneas.
//   node scripts/silka-launch.mjs <tareas.json> [--max 4]
// tareas.json: lista de TaskSpec (title, scope, deliver, prompt, agent, model, verify, dependsOn…).
import fs from 'node:fs';
import { ensureHub, withClient } from '../src/silka/hub.mjs';
import { createHubCallAdapter } from '../src/silka/tasks/hub-call.mjs';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('Uso: node scripts/silka-launch.mjs <tareas.json> [--max 4]'); process.exit(1); }
const max = Number(rest[rest.indexOf('--max') + 1]) || 4;
const rules = '\n\nReglas: trabaja solo en este directorio, sin commits ni cambio de rama, sin dependencias nuevas. '
  + 'Lee la spec indicada en openspec/specs/. Las pruebas van en test/*.test.mjs (node:test); npm test las toma solas, '
  + 'no edites el script "test" de package.json. Corre `npm test` antes de terminar. '
  + 'Termina con un mensaje de 6 líneas o menos con el resultado REAL de npm test.';
const tasks = JSON.parse(fs.readFileSync(file, 'utf8'))
  .map((t) => ({ verify: ['npm test'], maxRepairs: 1, ...t, prompt: `${t.prompt}${rules}` }));

await ensureHub();
await withClient(async (client) => {
  const mgr = createTaskManager(process.cwd(), { maxConcurrentTasks: max, preferManual: false });
  await mgr.launch(tasks, { cause: 'cli', callHub: createHubCallAdapter(client), manual: false });
  const local = process.env.LOCALAPPDATA || '';
  for (const t of mgr.list().filter((x) => tasks.some((y) => y.id === x.id))) {
    const wt = t.worktreePath ? t.worktreePath.replace(local, '%LOCALAPPDATA%') : '-';
    console.log(`${t.id.padEnd(18)} ${t.state.padEnd(22)} ${wt} ${t.startError || ''}`);
  }
});
process.exit(0);
