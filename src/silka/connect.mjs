import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './hub.mjs';

const IS_WIN = process.platform === 'win32';
export const HARNESSES = ['claude', 'codex', 'cursor', 'opencode'];

/**
 * Node estable para registrar en otros CLIs. Si `connect` corre dentro de un agente
 * (p. ej. Cursor usa su propio node.exe versionado), process.execPath apunta a un
 * binario que desaparece al actualizar ese agente. Preferimos el `node` del PATH.
 */
export function stableNode() {
  if (process.env.SILKA_NODE && fs.existsSync(process.env.SILKA_NODE)) return process.env.SILKA_NODE;
  const bundled = /cursor-agent|[\\/]versions[\\/]/i.test(process.execPath);
  if (!bundled) return process.execPath;
  const exe = IS_WIN ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || /cursor-agent/i.test(dir)) continue;
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function bridgeLaunch() {
  return {
    command: stableNode(),
    args: [path.join(repoRoot(), 'src', 'silka', 'cli.mjs'), 'bridge'],
  };
}

function quote(arg) {
  const text = String(arg);
  return /\s/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
}

function formatCommand(argv) {
  return argv.map(quote).join(' ');
}

function run(cmd, args) {
  const quoted = IS_WIN ? args.map(quote) : args;
  return spawnSync(cmd, quoted, { encoding: 'utf8', shell: IS_WIN, windowsHide: true, timeout: 45_000 });
}

function commandExists(cmd) {
  const probe = IS_WIN ? 'where.exe' : 'which';
  const result = spawnSync(probe, [cmd], { encoding: 'utf8', shell: false, windowsHide: true });
  return result.status === 0;
}

function cursorBin() {
  if (commandExists('cursor-agent')) return 'cursor-agent';
  if (commandExists('agent')) return 'agent';
  return null;
}

function normPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase();
}

function sameLaunch(command, args) {
  const want = bridgeLaunch();
  const gotArgs = args || [];
  return normPath(command) === normPath(want.command)
    && normPath(gotArgs[0]) === normPath(want.args[0])
    && gotArgs.map((part) => String(part).toLowerCase()).includes('bridge');
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cursorConfigPath() {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

function opencodeConfigPaths() {
  const dir = path.join(os.homedir(), '.config', 'opencode');
  return [path.join(dir, 'opencode.json'), path.join(dir, 'opencode.jsonc')];
}

function outputOf(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function claudePlan() {
  const launch = bridgeLaunch();
  const remove = ['mcp', 'remove', 'agent-rack'];
  const add = ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'agent-rack', '--', launch.command, ...launch.args];
  return { remove, add };
}

function claudeAlready() {
  const result = run('claude', ['mcp', 'get', 'agent-rack']);
  if (result.status !== 0) return false;
  const text = outputOf(result).replaceAll('\\', '/').toLowerCase();
  const launch = bridgeLaunch();
  return text.includes(launch.command.replaceAll('\\', '/').toLowerCase())
    && text.includes('cli.mjs')
    && text.includes('bridge');
}

function connectClaude({ dryRun }) {
  if (!commandExists('claude')) throw new Error('No encontré el CLI `claude`.');
  const plan = claudePlan();
  const already = claudeAlready();
  if (dryRun) {
    if (already) return 'claude: agent-rack ya apunta a silka bridge; no haría cambios.';
    return [
      'claude: reemplazaría el MCP agent-rack por silka bridge.',
      `  ${formatCommand(['claude', ...plan.remove])}`,
      `  ${formatCommand(['claude', ...plan.add])}`,
    ].join('\n');
  }
  if (already) return 'claude: agent-rack ya apunta a silka bridge.';
  run('claude', plan.remove);
  const added = run('claude', plan.add);
  if (added.status !== 0) throw new Error(`claude mcp add falló.\n${outputOf(added)}`);
  return 'claude: agent-rack ahora es silka bridge.';
}

function disconnectClaude({ dryRun }) {
  if (!commandExists('claude')) throw new Error('No encontré el CLI `claude`.');
  const remove = ['mcp', 'remove', 'agent-rack'];
  if (dryRun) return `claude: ${formatCommand(['claude', ...remove])}`;
  const result = run('claude', remove);
  if (result.status !== 0 && !/not found|no such|does not exist|couldn't find/i.test(outputOf(result))) {
    throw new Error(`claude mcp remove falló.\n${outputOf(result)}`);
  }
  return 'claude: agent-rack desconectado.';
}

function codexEntryMatches(text) {
  const start = String(text).indexOf('[');
  const end = String(text).lastIndexOf(']');
  if (start < 0 || end < start) return false;
  try {
    const list = JSON.parse(text.slice(start, end + 1));
    const entry = (Array.isArray(list) ? list : []).find((item) => item?.name === 'agent-rack');
    const transport = entry?.transport || entry;
    return Boolean(transport && sameLaunch(transport.command, transport.args));
  } catch {
    return false;
  }
}

function connectCodex({ dryRun }) {
  if (!commandExists('codex')) throw new Error('No encontré el CLI `codex`.');
  const launch = bridgeLaunch();
  const listed = run('codex', ['mcp', 'list', '--json']);
  const listText = outputOf(listed);
  if (listed.status === 0 && codexEntryMatches(listText)) {
    return dryRun
      ? 'codex: agent-rack ya apunta a silka bridge; no haría cambios.'
      : 'codex: agent-rack ya apunta a silka bridge.';
  }
  const add = ['mcp', 'add', 'agent-rack', '--', launch.command, ...launch.args];
  if (dryRun) {
    const lines = ['codex: registraría silka bridge como agent-rack.'];
    if (/agent-rack/.test(listText)) lines.push(`  ${formatCommand(['codex', 'mcp', 'remove', 'agent-rack'])}`);
    lines.push(`  ${formatCommand(['codex', ...add])}`);
    return lines.join('\n');
  }
  if (/agent-rack/.test(listText)) run('codex', ['mcp', 'remove', 'agent-rack']);
  const added = run('codex', add);
  if (added.status !== 0) throw new Error(`codex mcp add falló.\n${outputOf(added)}`);
  return 'codex: agent-rack ahora es silka bridge.';
}

function disconnectCodex({ dryRun }) {
  if (!commandExists('codex')) throw new Error('No encontré el CLI `codex`.');
  if (dryRun) return `codex: ${formatCommand(['codex', 'mcp', 'remove', 'agent-rack'])}`;
  const result = run('codex', ['mcp', 'remove', 'agent-rack']);
  if (result.status !== 0 && !/not found|no such|does not exist/i.test(outputOf(result))) {
    throw new Error(`codex mcp remove falló.\n${outputOf(result)}`);
  }
  return 'codex: agent-rack desconectado.';
}

function opencodeAgentEntries(parsed) {
  const mcp = parsed?.mcp;
  if (!mcp || typeof mcp !== 'object') return [];
  const entries = [];
  if (mcp['agent-rack']) entries.push(mcp['agent-rack']);
  if (mcp.servers?.['agent-rack']) entries.push(mcp.servers['agent-rack']);
  return entries;
}

function opencodeFilesWithServer() {
  return opencodeConfigPaths().filter((file) => {
    if (!fs.existsSync(file)) return false;
    try {
      return opencodeAgentEntries(readJson(file)).length > 0;
    } catch {
      return fs.readFileSync(file, 'utf8').includes('"agent-rack"');
    }
  });
}

function opencodeAlready() {
  for (const file of opencodeConfigPaths()) {
    let entries = [];
    try { entries = opencodeAgentEntries(readJson(file)); } catch { continue; }
    for (const entry of entries) {
      const command = Array.isArray(entry.command) ? entry.command : [entry.command, ...(entry.args || [])].filter(Boolean);
      if (sameLaunch(command[0], command.slice(1))) return true;
    }
  }
  return false;
}

function connectOpencode({ dryRun }) {
  if (!commandExists('opencode')) throw new Error('No encontré el CLI `opencode`.');
  const launch = bridgeLaunch();
  if (opencodeAlready()) {
    return dryRun
      ? 'opencode: agent-rack ya apunta a silka bridge; no haría cambios.'
      : 'opencode: agent-rack ya apunta a silka bridge.';
  }
  const add = ['mcp', 'add', '--global', 'agent-rack', '--', launch.command, ...launch.args];
  if (dryRun) return `opencode: ${formatCommand(['opencode', ...add])}`;
  const added = run('opencode', add);
  if (added.status === 0) return 'opencode: agent-rack ahora es silka bridge.';
  const files = opencodeFilesWithServer();
  if (!files.length) throw new Error(`opencode mcp add falló.\n${outputOf(added)}`);
  const file = files[0];
  const bak = backup(file);
  const parsed = readJson(file);
  parsed.mcp = parsed.mcp || {};
  parsed.mcp['agent-rack'] = {
    type: 'local',
    command: [launch.command, ...launch.args],
    enabled: true,
  };
  writeJson(file, parsed);
  return `opencode: agent-rack actualizado en ${file}${bak ? ` (respaldo ${bak})` : ''}.`;
}

function disconnectOpencode({ dryRun }) {
  const files = opencodeFilesWithServer();
  if (!files.length) return 'opencode: agent-rack ya no estaba.';
  if (dryRun) return files.map((file) => `opencode: quitaría agent-rack de ${file} (respaldo ${file}.bak)`).join('\n');
  const notes = [];
  for (const file of files) {
    const bak = backup(file);
    try {
      const parsed = readJson(file);
      if (parsed.mcp?.['agent-rack']) delete parsed.mcp['agent-rack'];
      if (parsed.mcp?.servers?.['agent-rack']) delete parsed.mcp.servers['agent-rack'];
      if (parsed.mcp?.servers && Object.keys(parsed.mcp.servers).length === 0) delete parsed.mcp.servers;
      writeJson(file, parsed);
    } catch {
      throw new Error(`No pude editar ${file}. Quítalo a mano; el respaldo está en ${bak || `${file}.bak`}.`);
    }
    notes.push(`opencode: agent-rack quitado de ${file}${bak ? ` (respaldo ${bak})` : ''}.`);
  }
  return notes.join('\n');
}

function connectCursor({ dryRun }) {
  const bin = cursorBin();
  if (!bin) throw new Error('No encontré `cursor-agent` ni `agent`.');
  const file = cursorConfigPath();
  const launch = bridgeLaunch();
  const parsed = fs.existsSync(file) ? readJson(file) : {};
  const current = parsed.mcpServers?.['agent-rack'];
  if (current && sameLaunch(current.command, current.args)) {
    return dryRun
      ? `cursor: agent-rack ya está en ${file}; no haría cambios.`
      : `cursor: agent-rack ya está en ${file}.`;
  }
  if (dryRun) {
    return `cursor: no tiene \`mcp add\`. Editaría ${file} (respaldo ${file}.bak) con command=${launch.command} args=${launch.args.join(' ')}`;
  }
  const bak = backup(file);
  parsed.mcpServers = parsed.mcpServers || {};
  parsed.mcpServers['agent-rack'] = { command: launch.command, args: launch.args };
  writeJson(file, parsed);
  return `cursor: agent-rack escrito en ${file}${bak ? ` (respaldo ${bak})` : ''}.`;
}

function disconnectCursor({ dryRun }) {
  const file = cursorConfigPath();
  if (!fs.existsSync(file)) return 'cursor: no hay mcp.json.';
  const parsed = readJson(file);
  if (!parsed.mcpServers?.['agent-rack']) return 'cursor: agent-rack ya no estaba.';
  if (dryRun) return `cursor: quitaría agent-rack de ${file} (respaldo ${file}.bak)`;
  const bak = backup(file);
  delete parsed.mcpServers['agent-rack'];
  writeJson(file, parsed);
  return `cursor: agent-rack quitado de ${file}${bak ? ` (respaldo ${bak})` : ''}.`;
}

const ACTIONS = {
  claude: { connect: connectClaude, disconnect: disconnectClaude },
  codex: { connect: connectCodex, disconnect: disconnectCodex },
  cursor: { connect: connectCursor, disconnect: disconnectCursor },
  opencode: { connect: connectOpencode, disconnect: disconnectOpencode },
};

export function connectHarness(target, { dryRun = false } = {}) {
  const names = target === 'all' ? HARNESSES : [target];
  if (!names.length || names.some((name) => !ACTIONS[name])) {
    throw new Error(`Uso: silka connect <${HARNESSES.join('|')}|all>`);
  }
  return names.map((name) => ACTIONS[name].connect({ dryRun })).join('\n');
}

export function disconnectHarness(target, { dryRun = false } = {}) {
  const names = target === 'all' ? HARNESSES : [target];
  if (!names.length || names.some((name) => !ACTIONS[name])) {
    throw new Error(`Uso: silka disconnect <${HARNESSES.join('|')}|all>`);
  }
  return names.map((name) => ACTIONS[name].disconnect({ dryRun })).join('\n');
}
