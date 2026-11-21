// Prueba de punta a punta con agent-rack REAL (no un hub falso): crea un worktree en la carpeta de
// Silka (%LOCALAPPDATA%\silka\wt en Windows), arranca agent-rack con la config efectiva que genera
// el hub y crea una sesión de agente de verdad en ese worktree. Es el paso que validaba
// allowedWorkspaces y que las pruebas con hub falso no cubrían (BUG-08).
//   node scripts/e2e-worktree-session.mjs [--port 18996] [--agent opencode] [--model opencode/hy4-flash-free]
// No arranca supervisores ni toca tareas: solo agent-rack en un puerto aparte.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DashboardRemoteClient } from 'agent-rack/dist/cli/dashboard/remoteClient.js';
import { tokenFilePath } from 'agent-rack/dist/security/auth.js';
import { loadSilkaConfig, writeEffectiveAgentRackConfig } from '../src/silka/hub.mjs';
import { signalProcessTree } from '../src/silka/proc.mjs';
import { currentCommit, gitRun } from '../src/silka/tasks/git.mjs';
import { removeTaskWorktree, worktreePath } from '../src/silka/tasks/worktree.mjs';
import { prepareWorktreeRemoval } from '../src/silka/tasks/worktree-cleanup.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const port = Number(arg('port', 18996));
const agent = arg('agent', 'opencode');
const model = arg('model', 'opencode/hy4-flash-free');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { root, config } = loadSilkaConfig();
const id = `e2e-${Date.now().toString(36)}`;
const wt = worktreePath(root, id);
let server;
let ok = false;
try {
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const add = gitRun(root, ['worktree', 'add', '--detach', wt, currentCommit(root)], { repoRoot: root });
  if (!add.ok) throw new Error(`git worktree add: ${add.stderr}`);
  console.log(`worktree: ${wt}`);

  // --sin-arreglo: usa la config original del usuario, para comprobar que sin el arreglo falla.
  const cfgFile = process.argv.includes('--sin-arreglo')
    ? (() => { const f = path.join(path.dirname(tokenFilePath(port)), `e2e-original-${port}.json`); fs.writeFileSync(f, JSON.stringify({ ...config, port })); return f; })()
    : writeEffectiveAgentRackConfig({ ...config, port }, port);
  const bin = path.join(root, 'node_modules', 'agent-rack', 'bin', 'agent-rack.js');
  server = spawn(process.execPath, [bin, 'start', '-t', 'sse', '-c', cfgFile], { cwd: root, stdio: ['pipe', 'ignore', 'ignore'] });
  let runtime = null;
  for (let i = 0; i < 80 && !runtime; i += 1) {
    await sleep(250);
    try {
      const r = JSON.parse(fs.readFileSync(tokenFilePath(port), 'utf8'));
      if (r.pid === server.pid) runtime = r;
    } catch { /* aún no */ }
  }
  if (!runtime) throw new Error('agent-rack de prueba no arrancó');

  const client = new DashboardRemoteClient(`http://127.0.0.1:${port}/sse`, runtime.token);
  await client.connect();
  // createSession lanza el error de agent-rack (p. ej. "is not within allowedWorkspaces") si la rechaza.
  const { sessionId } = await client.createSession(agent, 'Responde solo: ok', wt, model);
  console.log(`sesión creada en el worktree: ${sessionId}`);
  for (let i = 0; i < 120; i += 1) {
    const st = await client.getSessionStatus(sessionId);
    if (!/running|starting/.test(st.status)) { console.log(`la sesión terminó: ${st.status}`); ok = st.status === 'completed'; break; }
    await sleep(1000);
  }
  await client.close().catch(() => {});
} catch (err) {
  console.error(`FALLÓ: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (server) signalProcessTree(server.pid, { force: true });
  try { fs.rmSync(tokenFilePath(port), { force: true }); } catch { /* ya no está */ }
  prepareWorktreeRemoval(root, wt);
  removeTaskWorktree(root, id, wt);
  gitRun(root, ['worktree', 'prune'], { repoRoot: root });
  console.log(`worktree borrado: ${!fs.existsSync(wt)}`);
}
console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALLA');
process.exit(ok ? 0 : 1);
