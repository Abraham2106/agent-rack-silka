// Delegar una tarea y esperar a que termine, sin gastar tokens en monitorearla.
//   node scripts/delegate.mjs <agente> <archivo-prompt|"prompt"> [--model m] [--workspace dir] [--timeout s]
// Si hay un hub de silka vivo, la sesión corre ahí (se ve en `silka ui`). Si no, usa
// agent-rack por stdio. Al final imprime solo el estado y la respuesta final del agente.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hubStatus, withClient, rememberPrompt } from '../src/silka/hub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [agent, promptArg, ...rest] = process.argv.slice(2);
if (!agent || !promptArg) { console.error('Uso: node scripts/delegate.mjs <agente> <archivo|prompt> [--model m] [--workspace dir] [--timeout s]'); process.exit(2); }
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const prompt = fs.existsSync(promptArg) ? fs.readFileSync(promptArg, 'utf8') : promptArg;
const workspace = path.resolve(opt.workspace ?? process.cwd());
const timeout = Number(opt.timeout ?? 1800);
const label = `${agent}${opt.model ? ' · ' + opt.model : ''}`;
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (hubStatus().alive) {
  await withClient(async (client, status) => {
    const s = await client.createSession(agent, prompt, workspace, opt.model);
    try { rememberPrompt(status.port, s.sessionId, path.basename(promptArg)); } catch { /* opcional */ }
    console.log(`[${label}] sesión ${s.sessionId} en el hub (míralo con: npm run silka -- ui)`);
    let st;
    for (;;) {
      await sleep(5000);
      st = await client.getSessionStatus(s.sessionId);
      if (!['running', 'cancelling', 'starting', 'pending'].includes(st.status)) break;
      if ((Date.now() - t0) / 1000 > timeout) { await client.cancelSession(s.sessionId); st = { ...st, status: 'timeout' }; break; }
    }
    console.log(`[${label}] ${((Date.now() - t0) / 1000).toFixed(0)}s estado=${st.status}`);
    console.log(st.summary ?? st.error ?? '');
  });
} else {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'node_modules/agent-rack/bin/agent-rack.js'), 'start', '-c', path.join(root, 'agent-rack.config.json')],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'silka-delegate', version: '0.1.0' });
  await client.connect(transport);
  const res = await client.callTool(
    { name: 'agent_run', arguments: { agent, prompt, workspace, timeoutSeconds: timeout, ...(opt.model ? { model: opt.model } : {}) } },
    undefined,
    { timeout: (timeout + 60) * 1000 },
  );
  console.log(`[${label}] ${((Date.now() - t0) / 1000).toFixed(0)}s isError=${Boolean(res.isError)}`);
  console.log(res.content?.map((c) => c.text).join('\n') ?? '');
  await client.close();
}
