// Prueba end-to-end: levanta agent-rack por stdio (igual que Claude Code) y le
// delega una tarea pequeña a cada agente pedido.
//   node scripts/smoke.mjs codex opencode cursor
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = path.join(root, 'sandbox');
fs.mkdirSync(sandbox, { recursive: true });
const configPath = path.join(root, 'agent-rack.config.json');
if (!fs.existsSync(configPath)) { console.error('Falta agent-rack.config.json: corre primero  npm run setup'); process.exit(1); }
// Sin argumentos: prueba todos los agentes configurados.
const agents = process.argv.slice(2).length
  ? process.argv.slice(2)
  : Object.keys(JSON.parse(fs.readFileSync(configPath, 'utf8')).agents ?? {});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'node_modules/agent-rack/bin/agent-rack.js'), 'start', '-c', configPath],
  env: { ...process.env },
});
const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));

for (const agent of agents) {
  const file = `smoke-${agent}.txt`;
  fs.rmSync(path.join(sandbox, file), { force: true });
  const t0 = Date.now();
  const res = await client.callTool(
    {
      name: 'agent_run',
      arguments: {
        agent,
        workspace: sandbox,
        timeoutSeconds: 240,
        prompt: `Crea el archivo ${file} con exactamente este texto: hola "mundo" & 100%\nCuando termines responde solo: LISTO`,
      },
    },
    undefined,
    { timeout: 300_000 },
  );
  const text = res.content?.map((c) => c.text).join('\n') ?? '';
  const created = fs.existsSync(path.join(sandbox, file)) ? fs.readFileSync(path.join(sandbox, file), 'utf8').trim() : '(no existe)';
  console.log(`\n== ${agent}  ${((Date.now() - t0) / 1000).toFixed(0)}s  isError=${Boolean(res.isError)}`);
  console.log('respuesta (' + text.length + ' chars):', text.slice(0, 600));
  console.log('archivo:', created);
}
await client.close();
