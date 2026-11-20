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
  silka bridge
  silka connect <claude|codex|cursor|opencode|all> [--dry-run]
  silka disconnect <claude|codex|cursor|opencode|all> [--dry-run]

Sin hub, los comandos responden: corre: silka hub
bridge es el MCP por stdio que comparte ese hub.`);
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
  if (cmd === 'bridge') {
    const { startBridge } = await import('./bridge.mjs');
    await startBridge();
    return 'stay';
  }
  if (cmd === 'connect' || cmd === 'disconnect') {
    const { connectHarness, disconnectHarness } = await import('./connect.mjs');
    const dryRun = argv.includes('--dry-run');
    const target = argv.slice(1).find((arg) => !arg.startsWith('--'));
    if (!target) throw new Error(`Uso: silka ${cmd} <claude|codex|cursor|opencode|all> [--dry-run]`);
    const text = cmd === 'connect' ? connectHarness(target, { dryRun }) : disconnectHarness(target, { dryRun });
    console.log(text);
    return;
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
