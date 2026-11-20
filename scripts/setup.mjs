#!/usr/bin/env node
// Setup de un comando:  npm run setup  [-- opciones]
//
//   --workspace <dir>      Carpeta donde los agentes pueden trabajar (repetible).
//                          Por defecto: la carpeta padre de este repo.
//   --codex-model <m>      Modelo para Codex (por defecto: el de tu ~/.codex/config.toml).
//   --opencode-model <m>   Modelo para OpenCode (por defecto: opencode/hy4-flash-free).
//   --cursor-model <m>     Modelo para Cursor (por defecto: el de tu cuenta).
//   --policy <p>           read-only | workspace-write (defecto) | danger-full-access
//   --scope <s>            Alcance en Claude Code: user (defecto) | project | local
//   --no-register          No registra el MCP en Claude Code (solo imprime el comando).
//   --no-skill             No instala el skill "delegar" en ~/.claude/skills.
//   --no-bridge            No registra silka bridge; deja el MCP stdio directo de agent-rack.
//   --connect all          Registra el puente en Claude, Codex, Cursor y OpenCode.
//
// Es idempotente: si ya existe agent-rack.config.json, conserva carpetas y modelos que
// no pases por flag.

import { execFileSync, spawnSync } from 'node:child_process';
import { connectHarness } from '../src/silka/connect.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'agent-rack.config.json');
const SHIM = path.join(ROOT, 'shims', 'agent-shim.mjs').replaceAll('\\', '/');
const SERVER = path.join(ROOT, 'node_modules', 'agent-rack', 'bin', 'agent-rack.js');
const IS_WIN = process.platform === 'win32';

const c = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const green = c(32), yellow = c(33), red = c(31), bold = c(1), dim = c(2);
const ok = (m) => console.log(`${green('✓')} ${m}`);
const warn = (m) => console.log(`${yellow('!')} ${m}`);
const info = (m) => console.log(`${dim('·')} ${m}`);

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = { workspace: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const take = () => argv[++i];
  if (a === '--workspace') flags.workspace.push(path.resolve(take()));
  else if (a === '--codex-model') flags.codexModel = take();
  else if (a === '--opencode-model') flags.opencodeModel = take();
  else if (a === '--cursor-model') flags.cursorModel = take();
  else if (a === '--policy') flags.policy = take();
  else if (a === '--scope') flags.scope = take();
  else if (a === '--no-register') flags.noRegister = true;
  else if (a === '--no-skill') flags.noSkill = true;
  else if (a === '--no-bridge') flags.noBridge = true;
  else if (a === '--connect') {
    const value = take();
    if (value !== 'all') { console.error(red('Usa --connect all')); process.exit(2); }
    flags.connectAll = true;
  }
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else { console.error(red(`Opción desconocida: ${a}`)); process.exit(2); }
}

console.log(bold('\nagent-rack-silka · setup\n'));

// ---- 1. node + dependencias -------------------------------------------------
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) { console.error(red(`Necesitas Node.js 20+ (tienes ${process.versions.node}).`)); process.exit(1); }
ok(`Node.js ${process.versions.node}`);

if (!fs.existsSync(SERVER)) {
  info('Instalando dependencias (npm install)…');
  // .npmrc ya trae ignore-scripts=true: el postinstall de agent-rack es solo Unix.
  const r = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  if (r.status !== 0 || !fs.existsSync(SERVER)) { console.error(red('npm install falló.')); process.exit(1); }
}
ok('agent-rack instalado');

// ---- 2. detectar agentes ----------------------------------------------------
function version(cmd) {
  try {
    const out = execFileSync(cmd, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN, timeout: 30_000 });
    return out.trim().split(/\r?\n/)[0];
  } catch { return null; }
}
const detected = {
  codex: version('codex'),
  opencode: version('opencode'),
  cursor: version('cursor-agent') ?? version('agent'),
};
const install = {
  codex: 'npm i -g @openai/codex   y luego: codex login',
  opencode: 'npm i -g opencode-ai     y luego: opencode auth login',
  cursor: 'https://cursor.com/cli   y luego: cursor-agent login',
};
for (const [k, v] of Object.entries(detected)) {
  if (v) ok(`${k.padEnd(8)} ${dim(v)}`);
  else warn(`${k.padEnd(8)} no encontrado → ${install[k]}`);
}
if (!Object.values(detected).some(Boolean)) {
  console.error(red('\nNo hay ningún agente instalado. Instala al menos uno y vuelve a correr el setup.'));
  process.exit(1);
}

// ---- 3. config --------------------------------------------------------------
let prev = {};
try { prev = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { /* primera vez */ }
const prevModel = (k) => prev.agents?.[k]?.model;

const workspaces = flags.workspace.length ? flags.workspace
  : prev.allowedWorkspaces?.length ? prev.allowedWorkspaces
  : [path.dirname(ROOT)];
for (const w of workspaces) if (!fs.existsSync(w)) warn(`La carpeta ${w} no existe (agent-rack la rechazará).`);

const agents = {};
if (detected.codex) {
  agents.codex = {
    name: 'Codex CLI',
    command: 'node',
    args: [SHIM, 'codex', 'exec', '--json', '--skip-git-repo-check'],
    transport: 'codex_exec_json',
    description: 'OpenAI Codex. Sandbox real (read-only / workspace-write). Bueno para implementar features, refactors y fixes con tests.',
  };
  const m = flags.codexModel ?? prevModel('codex');
  if (m) agents.codex.model = m;
}
if (detected.opencode) {
  agents.opencode = {
    name: 'OpenCode',
    command: 'node',
    args: [SHIM, 'opencode'],
    transport: 'claude_stream_json',
    model: flags.opencodeModel ?? prevModel('opencode') ?? 'opencode/hy4-flash-free',
    description: 'OpenCode (cualquier proveedor; model=proveedor/modelo). Por defecto un modelo gratis: ideal para tareas baratas, simples o repetitivas.',
  };
}
if (detected.cursor) {
  agents.cursor = {
    name: 'Cursor Agent',
    command: 'node',
    args: [SHIM, 'cursor'],
    transport: 'claude_stream_json',
    description: 'Cursor CLI. Bueno para UI/frontend y cambios en varios archivos. mode=plan es solo lectura.',
  };
  const m = flags.cursorModel ?? prevModel('cursor');
  if (m) agents.cursor.model = m;
}

const config = {
  transport: 'stdio',
  enableSseSidecar: true,
  allowedWorkspaces: workspaces.map((w) => w.replaceAll('\\', '/')),
  agents,
  security: {
    executionPolicy: flags.policy ?? prev.security?.executionPolicy ?? 'workspace-write',
    sanitizeEnv: true,
    maxConcurrentSessions: 5,
    defaultTimeoutSeconds: 900,
    sessionRetentionMinutes: 120,
    requireSseAuth: true,
  },
};
fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
ok(`Config escrita: ${path.relative(process.cwd(), CONFIG) || CONFIG}`);
info(`Carpetas permitidas: ${config.allowedWorkspaces.join(', ')}`);

const check = spawnSync(process.execPath, [SERVER, 'config-check', '-c', CONFIG], { encoding: 'utf8' });
if (check.status !== 0) { console.error(red('La config no pasó la validación:\n') + check.stdout + check.stderr); process.exit(1); }
ok('Config válida');

// ---- 4. registrar el MCP ----------------------------------------------------
const scope = flags.scope ?? 'user';
const hasClaude = Boolean(version('claude'));
if (flags.noBridge) {
  const addArgs = ['mcp', 'add', '--scope', scope, 'agent-rack', '--', 'node', SERVER.replaceAll('\\', '/'), 'start', '-c', CONFIG.replaceAll('\\', '/')];
  if (flags.noRegister || !hasClaude) {
    if (!hasClaude) warn('No encontré el CLI `claude`. Registra el MCP a mano:');
    console.log('\n  claude ' + addArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') + '\n');
  } else {
    spawnSync('claude', ['mcp', 'remove', 'agent-rack', '--scope', scope], { stdio: 'ignore', shell: IS_WIN });
    const r = spawnSync('claude', addArgs.map((a) => (IS_WIN && /\s/.test(a) ? `"${a}"` : a)), { encoding: 'utf8', shell: IS_WIN });
    if (r.status === 0) ok(`Registrado en Claude Code (scope: ${scope})`);
    else { warn('No pude registrar el MCP automáticamente:'); console.log(r.stdout + r.stderr); }
  }
} else {
  const target = flags.connectAll ? 'all' : 'claude';
  try {
    const text = connectHarness(target, { dryRun: Boolean(flags.noRegister) });
    for (const line of text.split('\n')) ok(line);
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }
}

const SILKA_MCP = path.join(ROOT, 'src', 'silka', 'mcp.mjs').replaceAll('\\', '/');
const silkaAdd = ['mcp', 'add', '--scope', scope, 'silka', '--', 'node', SILKA_MCP];
if (flags.noRegister || !hasClaude) {
  if (!hasClaude) warn('No encontré el CLI `claude`. Registra el MCP de silka a mano:');
  console.log('\n  claude ' + silkaAdd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') + '\n');
} else {
  spawnSync('claude', ['mcp', 'remove', 'silka', '--scope', scope], { stdio: 'ignore', shell: IS_WIN });
  const r = spawnSync('claude', silkaAdd.map((a) => (IS_WIN && /\s/.test(a) ? `"${a}"` : a)), { encoding: 'utf8', shell: IS_WIN });
  if (r.status === 0) ok(`silka registrado en Claude Code (scope: ${scope})`);
  else { warn('No pude registrar el MCP de silka automáticamente:'); console.log(r.stdout + r.stderr); }
}

// ---- 5. skill ---------------------------------------------------------------
if (!flags.noSkill) {
  const src = path.join(ROOT, 'skills', 'delegar');
  const dest = path.join(os.homedir(), '.claude', 'skills', 'delegar');
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  ok(`Skill "delegar" instalado en ${dest}`);
}

// ---- listo ------------------------------------------------------------------
console.log(bold('\nListo.'));
console.log(`  1. Asegúrate de haber iniciado sesión en cada agente (codex login · opencode auth login · cursor-agent login).`);
console.log(`  2. Reinicia Claude Code (o abre una sesión nueva) para cargar las herramientas.`);
console.log(`  3. Prueba:  ${bold('npm run smoke')}   ${dim('(una tarea mini con cada agente)')}\n`);
