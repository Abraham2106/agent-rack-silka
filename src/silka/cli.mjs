#!/usr/bin/env node
import { listSessionsCommand, noteSession, queueCommand, runSession, sendMessage, steerSession } from './commands.mjs';
import { startHub, withClient } from './hub.mjs';

function printHelp() {
  console.log(`silka — hub y TUI para sesiones de agent-rack

  silka hub
  silka ls
  silka run <agente> "<prompt>" [--model m] [--workspace dir]
  silka send <id> "<mensaje>" [--now]
  silka queue <id> [--clear]
  silka steer <id> "<mensaje>"   (alias de send --now)
  silka note <id> "<texto>"
  silka ui
  silka models [agente] [--refresh] [--json]
  silka models default <agente> <modelo>
  silka models filter <agente> [patrón...]   (sin patrones: quita el filtro; --all ignora filtros)
  silka mcp
  silka bridge
  silka connect <claude|codex|cursor|opencode|all> [--dry-run] [--with-graph]
  silka disconnect <claude|codex|cursor|opencode|all> [--dry-run]
  silka graph status [workspace]
  silka graph build [workspace]

Sin hub, los comandos responden: corre: silka hub
bridge es el MCP por stdio que comparte ese hub.
graph build usa Graphify si está instalado; sin él, silka sigue igual.`);
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
  if (cmd === 'graph') {
    const { buildGraph, graphStatus } = await import('./graph.mjs');
    const sub = argv[1];
    const workspace = argv.slice(2).find((arg) => !arg.startsWith('--')) || process.cwd();
    if (sub === 'status') {
      console.log(graphStatus(workspace).text);
      return;
    }
    if (sub === 'build') {
      console.log(buildGraph(workspace));
      return;
    }
    throw new Error('Uso: silka graph build|status [workspace]');
  }
  if (cmd === 'models') {
    const { loadModels, setDefaultModel } = await import('./models.mjs');
    const { loadSilkaConfig } = await import('./hub.mjs');
    const { configPath, config } = loadSilkaConfig();
    if (argv[1] === 'filter') {
      const { setModelFilter } = await import('./models.mjs');
      const [agent, ...patterns] = argv.slice(2);
      if (!agent) throw new Error('Uso: silka models filter <agente> [patrón...]');
      const kept = setModelFilter(agent, patterns);
      console.log(kept.length ? `${agent}: solo modelos que coinciden con ${kept.join(' | ')}` : `${agent}: sin filtro`);
      return;
    }
    if (argv[1] === 'default') {
      const [agent, model] = argv.slice(2);
      if (!agent) throw new Error('Uso: silka models default <agente> <modelo>');
      setDefaultModel(configPath, agent, model);
      console.log(model ? `${agent}: modelo por defecto → ${model}` : `${agent}: sin modelo por defecto`);
      return;
    }
    const refresh = argv.includes('--refresh');
    const asJson = argv.includes('--json');
    const only = argv.slice(1).find((arg) => !arg.startsWith('--'));
    const agents = only ? [only] : Object.keys(config.agents ?? {});
    const out = {};
    for (const agent of agents) out[agent] = await loadModels(agent, { refresh, all: argv.includes('--all') });
    if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
    for (const [agent, cat] of Object.entries(out)) {
      const def = config.agents?.[agent]?.model;
      console.log(`
${agent}  (${cat.models.length}${cat.total > cat.models.length ? ` de ${cat.total}` : ''} modelos${def ? `, por defecto ${def}` : ''})${cat.error ? `  ! ${cat.error}` : ''}`);
      for (const m of cat.models.slice(0, only ? 400 : 8)) {
        const marks = [m.id === def ? '★' : ' ', m.free ? 'gratis' : '', m.available ? '' : '✗ no disponible'].filter(Boolean).join(' ');
        console.log(`  ${m.id.padEnd(42)} ${marks}`);
      }
      if (!only && cat.models.length > 8) console.log(`  … ${cat.models.length - 8} más (silka models ${agent})`);
    }
    return;
  }
  if (cmd === 'connect' || cmd === 'disconnect') {
    const { connectHarness, disconnectHarness } = await import('./connect.mjs');
    const dryRun = argv.includes('--dry-run');
    const withGraph = argv.includes('--with-graph');
    const target = argv.slice(1).find((arg) => !arg.startsWith('--'));
    if (!target) throw new Error(`Uso: silka ${cmd} <claude|codex|cursor|opencode|all> [--dry-run] [--with-graph]`);
    const text = cmd === 'connect'
      ? connectHarness(target, { dryRun, withGraph, workspace: process.cwd() })
      : disconnectHarness(target, { dryRun });
    console.log(text);
    return;
  }
  if (!['ls', 'run', 'send', 'queue', 'steer', 'note', 'ui'].includes(cmd)) {
    printHelp();
    throw new Error(`Comando desconocido: ${cmd}`);
  }
  // ui y run no deberían pedirte abrir otra terminal: si no hay hub, lo levantan en segundo plano.
  if (cmd === 'ui' || cmd === 'run') {
    const { ensureHub, hubStatus } = await import('./hub.mjs');
    if (!hubStatus().alive) {
      process.stderr.write('Arrancando el hub en segundo plano…\n');
      await ensureHub();
    }
  }
  await withClient(async (client, status) => {
    if (cmd === 'ls') return listSessionsCommand(client, status.port);
    if (cmd === 'run') return runSession(client, status, argv.slice(1));
    if (cmd === 'send') return sendMessage(client, argv.slice(1));
    if (cmd === 'queue') return queueCommand(client, argv.slice(1));
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
