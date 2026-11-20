// Delegar una tarea por agent-rack (MCP stdio) sin pasar por Claude Code.
//   node scripts/delegate.mjs <agente> <archivo-prompt|"prompt"> [--model m] [--workspace dir] [--timeout s]
// Imprime solo la respuesta final del agente.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [agent, promptArg, ...rest] = process.argv.slice(2);
if (!agent || !promptArg) { console.error('Uso: node scripts/delegate.mjs <agente> <archivo|prompt> [--model m] [--workspace dir] [--timeout s]'); process.exit(2); }
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const prompt = fs.existsSync(promptArg) ? fs.readFileSync(promptArg, 'utf8') : promptArg;
const timeout = Number(opt.timeout ?? 1800);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'node_modules/agent-rack/bin/agent-rack.js'), 'start', '-c', path.join(root, 'agent-rack.config.json')],
  stderr: 'ignore',
});
const client = new Client({ name: 'silka-delegate', version: '0.1.0' });
await client.connect(transport);
const t0 = Date.now();
const res = await client.callTool(
  { name: 'agent_run', arguments: { agent, prompt, workspace: path.resolve(opt.workspace ?? process.cwd()), timeoutSeconds: timeout, ...(opt.model ? { model: opt.model } : {}) } },
  undefined,
  { timeout: (timeout + 60) * 1000 },
);
console.log(`[${agent}${opt.model ? ' · ' + opt.model : ''}] ${((Date.now() - t0) / 1000).toFixed(0)}s isError=${Boolean(res.isError)}`);
console.log(res.content?.map((c) => c.text).join('\n') ?? '');
await client.close();
