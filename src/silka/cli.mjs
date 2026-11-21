#!/usr/bin/env node
// Sin imports pesados arriba: `silka ui` muestra su pantalla de carga antes de cargar
// el cliente del hub (MCP SDK, zod, ajv) e Ink (~900 módulos en total).

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
  silka task run <archivo-plan> [--workspace dir]
  silka plan status <planId> [workspace]
  silka task ls [workspace]
  silka task verify <id> [workspace]
  silka review ls [workspace]
  silka review approve <id> --version N [workspace]
  silka review reject <id> "<nota>" --version N [workspace]
  silka review discard <id> --version N [workspace]
  silka merge ls [workspace]
  silka merge status <id> [workspace]
  silka metrics [ls|stats <agente> [modelo]|baseline [N]]

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
    const { startHub } = await import('./hub.mjs');
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
  if (cmd === 'logo') {
    // Imprime la marca a tamaño real con color de 24 bits (para revisarla en tu terminal).
    const { logoRows } = await import('./ui/theme.mjs');
    const size = Number(argv[1]) === 32 ? 32 : 64;
    const hex = (h) => { const n = Number.parseInt(h.slice(1), 16); return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`; };
    for (const row of logoRows(size)) {
      console.log(row.map((s) => (s.color ? `\x1b[38;2;${hex(s.color)}m` : '') + (s.backgroundColor ? `\x1b[48;2;${hex(s.backgroundColor)}m` : '') + s.text + '\x1b[0m').join(''));
    }
    return;
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
  if (cmd === 'metrics') {
    const { metricsCommand } = await import('./metrics/cli.mjs');
    metricsCommand(argv.slice(1), process.cwd());
    return;
  }
  if (cmd === 'plan') {
    const sub = argv[1];
    const { parseArgs } = await import('./commands.mjs');
    const { positional } = parseArgs(argv.slice(2));
    if (sub === 'status') {
      const { planStatus } = await import('./integration/cli.mjs');
      const id = positional[0];
      const ws = positional[1] || process.cwd();
      if (!id) throw new Error('Uso: silka plan status <planId> [workspace]');
      planStatus(id, ws);
      return;
    }
    throw new Error('Uso: silka plan status <planId> [workspace]');
  }
  if (cmd === 'task') {
    const sub = argv[1];
    const { taskRunFromFile, taskList, taskVerify } = await import('./tasks/cli.mjs');
    const { parseArgs } = await import('./commands.mjs');
    const { flags, positional } = parseArgs(argv.slice(2));
    const workspace = flags.workspace || process.cwd();
    if (sub === 'run') {
      const planFile = positional[0];
      if (!planFile) throw new Error('Uso: silka task run <archivo-plan> [--workspace dir]');
      const { withClient } = await import('./hub.mjs');
      const { createHubCallAdapter } = await import('./tasks/hub-call.mjs');
      const { loadSilkaConfig } = await import('./hub.mjs');
      await withClient(async (client) => {
        const { agents, config } = loadSilkaConfig();
        const def = agents[0] ? config.agents?.[agents[0]]?.model : '';
        await taskRunFromFile(planFile, {
          workspace,
          callHub: createHubCallAdapter(client),
          defaultAgent: agents[0] || 'codex',
          defaultModel: def || '',
        });
      });
      return;
    }
    if (sub === 'ls') {
      taskList(positional[0] || workspace);
      return;
    }
    if (sub === 'verify') {
      const id = positional[0];
      const ws = positional[1] || workspace;
      if (!id) throw new Error('Uso: silka task verify <id> [workspace]');
      taskVerify(id, ws);
      return;
    }
    throw new Error('Uso: silka task run|ls|verify ...');
  }
  if (cmd === 'review') {
    const sub = argv[1];
    const { parseArgs } = await import('./commands.mjs');
    const { reviewApprove, reviewDiscard, reviewList, reviewReject } = await import('./review/cli.mjs');
    const { flags, positional } = parseArgs(argv.slice(2));
    const version = Number(flags.version);
    if (sub === 'ls') {
      reviewList(flags.workspace || positional[0] || process.cwd());
      return;
    }
    const id = positional[0];
    const ws = positional[1] || flags.workspace || process.cwd();
    if (sub === 'approve') {
      if (!id || !Number.isFinite(version)) throw new Error('Uso: silka review approve <id> --version N [workspace]');
      reviewApprove(id, ws, { version });
      return;
    }
    if (sub === 'reject') {
      const note = positional[1];
      const wsReject = positional[2] || flags.workspace || process.cwd();
      if (!id || !note || !Number.isFinite(version)) {
        throw new Error('Uso: silka review reject <id> "<nota>" --version N [workspace]');
      }
      const { withClient } = await import('./hub.mjs');
      const { createHubCallAdapter } = await import('./tasks/hub-call.mjs');
      await withClient(async (client) => {
        await reviewReject(id, note, wsReject, { version, callHub: createHubCallAdapter(client) });
      });
      return;
    }
    if (sub === 'discard') {
      if (!id || !Number.isFinite(version)) throw new Error('Uso: silka review discard <id> --version N [workspace]');
      reviewDiscard(id, ws, { version });
      return;
    }
    throw new Error('Uso: silka review ls|approve|reject|discard ...');
  }
  if (cmd === 'merge') {
    const sub = argv[1];
    const { mergeList, mergeStatus } = await import('./merge/cli.mjs');
    const { parseArgs } = await import('./commands.mjs');
    const { flags, positional } = parseArgs(argv.slice(2));
    const ws = flags.workspace || process.cwd();
    if (sub === 'ls') {
      mergeList(positional[0] || ws);
      return;
    }
    if (sub === 'status') {
      const id = positional[0];
      if (!id) throw new Error('Uso: silka merge status <id> [workspace]');
      mergeStatus(id, positional[1] || ws);
      return;
    }
    throw new Error('Uso: silka merge ls|status ...');
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
  let splash = null;
  let uiModule = null;
  if (cmd === 'ui') {
    // React en modo desarrollo valida cada elemento y guarda pilas para depurar: era lo
    // que más CPU gastaba al teclear. Solo en este proceso; harnessFreeEnv lo quita antes
    // de pasar el entorno al hub (y de ahí a los agentes y a sus `npm install`).
    if (process.env.NODE_ENV === undefined) {
      process.env.NODE_ENV = 'production';
      process.env.SILKA_UI_NODE_ENV = '1';
    }
    const { startSplash } = await import('./ui/splash.mjs');
    splash = startSplash();
    // Ink y React cargan mientras se conecta el hub, no después.
    uiModule = import('./ui.mjs');
    uiModule.catch(() => {});
  }
  try {
    const { ensureHub, hubStatus, withClient } = await import('./hub.mjs');
    // ui y run no deberían pedirte abrir otra terminal: si no hay hub, lo levantan en segundo plano.
    if ((cmd === 'ui' || cmd === 'run') && !hubStatus().alive) {
      if (splash) splash.phase('arrancando el hub');
      else process.stderr.write('Arrancando el hub en segundo plano…\n');
      await ensureHub();
    }
    splash?.phase('conectando con el hub');
    const commands = cmd === 'ui' ? null : await import('./commands.mjs');
    await withClient(async (client, status) => {
      if (cmd === 'ls') return commands.listSessionsCommand(client, status.port);
      if (cmd === 'run') return commands.runSession(client, status, argv.slice(1));
      if (cmd === 'send') return commands.sendMessage(client, argv.slice(1));
      if (cmd === 'queue') return commands.queueCommand(client, argv.slice(1));
      if (cmd === 'steer') return commands.steerSession(client, status, argv.slice(1));
      if (cmd === 'note') return commands.noteSession(client, argv.slice(1));
      splash.phase('cargando la interfaz');
      const { runUi } = await uiModule;
      const models = Object.fromEntries(status.agents.map((id) => [id, status.config.agents?.[id]?.model || '']));
      splash.stop({ handoff: true });
      splash = null;
      return runUi({ client, port: status.port, agents: status.agents, models });
    });
  } finally {
    splash?.stop();
  }
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
