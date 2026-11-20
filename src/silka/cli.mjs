#!/usr/bin/env node
import { listSessionsCommand, noteSession, runSession, sendMessage, steerSession } from './commands.mjs';
import { startHub, withClient } from './hub.mjs';

function printHelp() {
  console.log(`silka — hub y TUI para sesiones de agent-rack

  silka hub
  silka ls
  silka run <agente> "<prompt>" [--model m] [--workspace dir]
  silka send <id> "<mensaje>"
  silka steer <id> "<instrucción>"
  silka note <id> "<texto>"
  silka ui
  silka mcp

Sin hub, los comandos responden: corre: silka hub`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }
  if (cmd === 'hub') {
    await startHub();
    return;
  }
  if (cmd === 'mcp') {
    const { startMcp } = await import('./mcp.mjs');
    await startMcp();
    return 'stay';
  }
  if (!['ls', 'run', 'send', 'steer', 'note', 'ui'].includes(cmd)) {
    printHelp();
    throw new Error(`Comando desconocido: ${cmd}`);
  }
  await withClient(async (client, status) => {
    if (cmd === 'ls') return listSessionsCommand(client, status.port);
    if (cmd === 'run') return runSession(client, status, argv.slice(1));
    if (cmd === 'send') return sendMessage(client, argv.slice(1));
    if (cmd === 'steer') return steerSession(client, status, argv.slice(1));
    if (cmd === 'note') return noteSession(client, argv.slice(1));
    const { runUi } = await import('./ui.mjs');
    const models = Object.fromEntries(status.agents.map((id) => [id, status.config.agents?.[id]?.model || '']));
    return runUi({ client, port: status.port, agents: status.agents, models });
  });
}

main()
  .then((stay) => {
    if (stay === 'stay') return;
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
