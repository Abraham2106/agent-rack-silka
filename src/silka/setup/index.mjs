// `silka setup`: detecta agentes, calcula qué archivos de la config de Silka habría que escribir
// y lo muestra como diff. Por defecto es --dry-run y no escribe nada; solo --apply escribe, y solo
// bajo silkaConfigDir(). Nunca toca la config global de agent-rack, Claude ni los agentes (FR-ST-03),
// ni instala CLIs ni inicia sesión.
import fs from 'node:fs';
import path from 'node:path';
import { detectAgents } from '../agents/detect.mjs';
import { bridgeLaunch } from '../connect.mjs';
import { effectiveAgentRackConfig, loadSilkaConfig } from '../hub.mjs';
import { writeAtomic } from '../lock.mjs';
import { silkaConfigDir } from '../paths.mjs';
import { lineDiff } from './diff.mjs';

/** Agentes que setup informa. Cursor instala `cursor-agent` o `agent` según la versión. */
export const SETUP_AGENTS = [
  { agent: 'codex', bin: 'codex' },
  { agent: 'opencode', bin: 'opencode' },
  { agent: 'cursor', bin: ['cursor-agent', 'agent'] },
];

const BRIDGE_FILE = 'bridge-mcp.json';

/** Contenidos que setup dejaría bajo la carpeta de config de Silka, según la config del usuario. */
export function desiredFiles({ config, port, bridge, configDir }) {
  const effective = `${JSON.stringify(effectiveAgentRackConfig(config), null, 2)}\n`;
  const bridgeBody = `${JSON.stringify({
    mcpServers: { 'agent-rack': { command: bridge.command, args: bridge.args } },
  }, null, 2)}\n`;
  return [
    { file: path.join(configDir, `agent-rack.effective-${port}.json`), body: effective },
    { file: path.join(configDir, BRIDGE_FILE), body: bridgeBody },
  ];
}

/** Compara lo deseado con lo existente. No escribe nada. */
export function planChanges(files, configDir) {
  return files.map(({ file, body }) => {
    // Defensa: setup nunca escribe fuera de la carpeta de config de Silka.
    const rel = path.relative(path.resolve(configDir), path.resolve(file));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`setup: ruta fuera de la config de Silka: ${file}`);
    const exists = fs.existsSync(file);
    const before = exists ? fs.readFileSync(file, 'utf8') : null;
    const action = !exists ? 'crear' : before === body ? 'sin cambios' : 'actualizar';
    return {
      file,
      name: path.relative(configDir, file).replaceAll('\\', '/'),
      action,
      body,
      diff: action === 'sin cambios' ? [] : lineDiff(before ?? '', body),
    };
  });
}

/** Escribe solo los cambios pendientes. Devuelve cuántos archivos se escribieron. */
export function applyChanges(changes, configDir) {
  let written = 0;
  for (const change of changes) {
    if (change.action === 'sin cambios') continue;
    const rel = path.relative(path.resolve(configDir), path.resolve(change.file));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`setup: ruta fuera de la config de Silka: ${change.file}`);
    writeAtomic(change.file, change.body);
    written += 1;
  }
  return written;
}

/**
 * Ejecuta setup. `deps` permite sustituir piezas en las pruebas (config, PATH, HOME, bridge).
 * Devuelve { exitCode, text, json } sin imprimir nada; el texto o el JSON lo imprime el llamador.
 */
export function runSetup(args = [], deps = {}) {
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  if (apply && dryRun) {
    const error = 'usa --apply o --dry-run, no los dos';
    return { exitCode: 1, text: `silka setup: ${error}`, json: { agents: [], changes: [], applied: false, error } };
  }
  const env = deps.env ?? process.env;
  const home = deps.home;
  const configDir = deps.configDir ?? silkaConfigDir();
  const agents = detectAgents(deps.agents ?? SETUP_AGENTS, { env, home }).map(({ agent, bin, installed, session }) => ({
    agent, bin, installed, session,
  }));

  let loaded;
  try {
    loaded = (deps.loadConfig ?? loadSilkaConfig)();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, text: `silka setup: ${error}`, json: { agents, changes: [], applied: false, error } };
  }

  const bridge = (deps.bridge ?? bridgeLaunch)();
  const changes = planChanges(desiredFiles({ config: loaded.config, port: loaded.port, bridge, configDir }), configDir);
  const pending = changes.filter((c) => c.action !== 'sin cambios');
  let applied = false;
  if (apply && pending.length > 0) {
    applyChanges(changes, configDir);
    applied = true;
  }

  const agentLines = agents.map((a) => {
    if (!a.installed) return `  ${a.agent.padEnd(10)} no instalado (no se intenta instalarlo)`;
    const sesion = a.session === null ? 'sesión no comprobable' : a.session ? 'con sesión' : 'sin sesión';
    return `  ${a.agent.padEnd(10)} instalado, ${sesion}`;
  });
  const changeLines = changes.flatMap((c) => [
    `  ${c.name}: ${c.action}`,
    ...c.diff.map((line) => `    ${line}`),
  ]);
  const footer = apply
    ? (applied ? `Aplicado: ${pending.length} archivo(s) escritos en ${configDir}.` : 'Sin cambios: la config de Silka ya estaba preparada.')
    : (pending.length ? 'Vista previa (--dry-run): no se ha escrito nada. Para aplicar: silka setup --apply' : 'Sin cambios: la config de Silka ya está preparada.');
  const text = [
    'Agentes:', ...agentLines,
    `Archivos bajo ${configDir}:`, ...(changeLines.length ? changeLines : ['  (nada)']),
    footer,
  ].join('\n');

  return {
    exitCode: 0,
    text,
    json: {
      agents,
      changes: changes.map(({ name, action, diff }) => ({ file: name, action, diff })),
      applied,
    },
  };
}

/** Subcomando `silka setup [--apply|--dry-run] [--json]`. */
export function setupCommand(args = []) {
  const result = runSetup(args);
  if (args.includes('--json')) console.log(JSON.stringify(result.json, null, 2));
  else console.log(result.text);
  return result.exitCode;
}
