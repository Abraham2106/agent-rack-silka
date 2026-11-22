// BUG-05: lanza N tareas en lote como el bridge (cliente al hub + launch con callHub) con UN hub y
// mide la pausa del proceso cliente y si la conexión se corta. Repo: clon desechable del repo de Silka
// (sin node_modules); agente con modelo inexistente (las sesiones terminan solas en segundos).
// Usar SIEMPRE contra un hub de prueba (otro puerto y config temporal), no el hub real:
//   SILKA_CONFIG=<config con otro "port"> SILKA_CONFIG_DIR=<carpeta temporal> node scripts/repro-bug05.mjs [N] [--setup-s S]
// Con --setup-s 8 --como-antes (setup lento dentro del launch) se reprodujo ECONNRESET con un solo hub.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const R = new URL('../src/silka/', import.meta.url).href;
const SILKA_REPO = fileURLToPath(new URL('..', import.meta.url));
const setupS = Number(process.argv[process.argv.indexOf('--setup-s') + 1]) || 0;
if (!process.env.SILKA_CONFIG) { console.error('Falta SILKA_CONFIG (config de un hub de prueba en otro puerto).'); process.exit(2); }
const { ensureHub, withClient } = await import(`${R}hub.mjs`);
const { createHubCallAdapter } = await import(`${R}tasks/hub-call.mjs`);
const { createTaskManager } = await import(`${R}tasks/manager.mjs`);
const { prepareWorktreeRemoval } = await import(`${R}tasks/worktree-cleanup.mjs`);
const { removeTaskWorktree } = await import(`${R}tasks/worktree.mjs`);
const n = Number(process.argv[2]) || 9;
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-bug05-'));
execFileSync('git', ['clone', '-q', '--local', SILKA_REPO, repo]);
console.log(`clon: ${repo}`);
await ensureHub();
let maxLag = 0; let last = Date.now();
const lag = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 100); last = now; }, 100);
const states = [];
const stamp = Date.now().toString(36);
const tasks = Array.from({ length: n }, (_, i) => ({
  id: `b05-${stamp}-${i}`, title: `t${i}`, scope: 'x', deliver: 'x', verify: 'node -e "0"', setup: setupS ? `node -e "setTimeout(()=>{},${setupS * 1000})"` : 'node -e "0"',
  agent: 'opencode', model: 'opencode/modelo-que-no-existe', prompt: 'Responde ok', maxRepairs: 0,
}));
let error = null; let mgr; const t0 = Date.now();
try {
  await withClient(async (client) => {
    mgr = createTaskManager(repo, { maxConcurrentTasks: n, preferManual: false });
    // Como el bridge actual (deferStart: el hub hace setup y sesiones); --como-antes repite el launch viejo.
    await mgr.launch(tasks, { cause: 'bug05', callHub: createHubCallAdapter(client), manual: false, deferStart: !process.argv.includes('--como-antes') });
  }, { onState: (s) => states.push(s) });
} catch (err) { error = err; }
clearInterval(lag);
console.log(`launch de ${n}: ${Date.now() - t0} ms, pausa máxima del proceso ${maxLag} ms`);
console.log(`error: ${error ? (error.message || String(error)) : 'ninguno'}`);
console.log(`estados del enlace: ${JSON.stringify(states)}`);
for (const t of mgr?.list() || []) console.log(`  ${t.id} ${t.state} ${t.startError ? `startError=${t.startError.slice(0, 90)}` : ''}`);
for (const t of mgr?.list() || []) {
  if (!t.worktreePath) continue;
  try { mgr.requestDiscard(t.id); } catch { prepareWorktreeRemoval(repo, t.worktreePath); removeTaskWorktree(repo, t.id, t.worktreePath); }
}
process.exit(0);
