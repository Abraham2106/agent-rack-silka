#!/usr/bin/env node
// agent-shim: puente entre agent-rack y los CLIs de Codex, OpenCode y Cursor.
//
//   node agent-shim.mjs codex exec --json ... <prompt>        -> passthrough a `codex`
//   node agent-shim.mjs opencode [--model m] [--resume id] [--permission-mode m] <prompt>
//   node agent-shim.mjs cursor   [--model m] [--resume id] [--permission-mode m] <prompt>
//
// OpenCode y Cursor se traducen al protocolo JSON de Claude Code (transporte
// `claude_stream_json` de agent-rack) y devuelven una línea:
//   {"type":"result","is_error":bool,"result":"...","session_id":"..."}
//
// Por qué existe:
//  - En Windows, execa (dentro de agent-rack) rechaza prompts multilínea cuando el CLI es
//    un .cmd. Aquí resolvemos el binario real (.exe o .js) y lo lanzamos sin shell, así el
//    prompt llega intacto aunque tenga saltos de línea, comillas, &, %, etc.
//  - agent-rack no trae transporte para Cursor, y su transporte PTY para OpenCode
//    devuelve texto crudo con ruido de terminal.
//
// Variables opcionales: CODEX_BIN, OPENCODE_BIN, CURSOR_AGENT_BIN (ruta al binario/JS),
// OPENCODE_DEFAULT_MODEL, AGENT_SHIM_NO_LOG=1.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
const [target, ...rest] = process.argv.slice(2);

// ---- parseo de args estilo Claude Code --------------------------------------
const VALUE_FLAGS = new Set(['--model', '--resume', '--permission-mode', '--output-format']);
const opts = {};
const positionals = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (VALUE_FLAGS.has(a)) { opts[a.slice(2)] = rest[++i]; continue; }
  const eq = a.match(/^--(model|resume|permission-mode|output-format)=(.*)$/s);
  if (eq) { opts[eq[1]] = eq[2]; continue; }
  positionals.push(a);
}
const prompt = positionals.at(-1) ?? '';
const readOnly = opts['permission-mode'] === 'plan';

function emit(obj, code) {
  process.stdout.write(JSON.stringify({ type: 'result', ...obj }) + '\n');
  process.exit(code);
}
function fail(msg) { emit({ is_error: true, result: msg }, 1); }

// ---- resolución de binarios -------------------------------------------------
/** Convierte una ruta de binario en {cmd, pre}: .exe/ejecutable directo, .js con node. */
function launcher(bin) {
  if (/\.(c|m)?js$/i.test(bin)) return { cmd: process.execPath, pre: [bin] };
  if (IS_WIN && !/\.(exe|com)$/i.test(bin)) {
    // En Windows un script sin extensión (launcher JS de npm) se corre con node.
    return { cmd: process.execPath, pre: [bin] };
  }
  return { cmd: bin, pre: [] };
}

/** Windows: lee `<name>.cmd` de npm en el PATH y devuelve el .exe/.js real que ejecuta. */
function binFromCmdShim(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const cmd = path.join(dir, `${name}.cmd`);
    if (!fs.existsSync(cmd)) continue;
    const text = fs.readFileSync(cmd, 'utf8');
    const hits = [...text.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => path.join(dir, m[1]));
    const found = hits.reverse().find((p) => fs.existsSync(p));
    if (found) return found;
  }
  return undefined;
}

/** Unix: primer ejecutable `<name>` en el PATH. */
function binFromPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* sigue */ }
  }
  return undefined;
}

/** Cursor en Windows usa un launcher .ps1 → buscamos la última versión instalada. */
function cursorFromVersions() {
  const base = process.env.CURSOR_AGENT_HOME
    || (IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'cursor-agent')
               : path.join(process.env.HOME || '', '.local', 'share', 'cursor-agent'));
  const vdir = path.join(base, 'versions');
  let dirs = [];
  try { dirs = fs.readdirSync(vdir).filter((d) => /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(d)); } catch { return undefined; }
  const key = (d) => { const [y, m, dd] = d.split('-')[0].split('.'); return Number(y + m.padStart(2, '0') + dd.padStart(2, '0')); };
  dirs.sort((a, b) => key(b) - key(a) || b.localeCompare(a));
  for (const d of dirs) {
    const js = path.join(vdir, d, 'index.js');
    if (!fs.existsSync(js)) continue;
    const bundledNode = path.join(vdir, d, IS_WIN ? 'node.exe' : 'node');
    return { cmd: fs.existsSync(bundledNode) ? bundledNode : process.execPath, pre: [js] };
  }
  return undefined;
}

function resolve(name, envVar) {
  const override = process.env[envVar];
  if (override && fs.existsSync(override)) return launcher(override);
  if (name === 'cursor-agent' && IS_WIN) {
    const v = cursorFromVersions();
    if (v) return v;
  }
  const bin = IS_WIN ? binFromCmdShim(name) : binFromPath(name);
  if (bin) return launcher(bin);
  if (name === 'cursor-agent') return cursorFromVersions();
  return undefined;
}

// ---- adaptadores ------------------------------------------------------------
function opencodeSpec() {
  const l = resolve('opencode', 'OPENCODE_BIN');
  if (!l) fail('No encontré OpenCode en el PATH (instálalo o define OPENCODE_BIN).');
  const args = ['run', '--format', 'json'];
  const model = opts.model || process.env.OPENCODE_DEFAULT_MODEL;
  if (model) args.push('-m', model);
  if (opts.resume) args.push('-s', opts.resume);
  if (readOnly) args.push('--agent', 'plan');
  // OpenCode resuelve rutas relativas contra la raíz del repo git, no contra el cwd.
  args.push(`[Directorio de trabajo: ${process.cwd()} (las rutas relativas son relativas a este directorio)]\n\n${prompt}`);
  return { cmd: l.cmd, args: [...l.pre, ...args], parse: parseOpencode };
}

function cursorSpec() {
  const l = resolve('cursor-agent', 'CURSOR_AGENT_BIN');
  if (!l) fail('No encontré cursor-agent (instálalo con https://cursor.com/cli o define CURSOR_AGENT_BIN).');
  const args = ['-p', '--output-format', 'json', '--trust'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.resume) args.push('--resume', opts.resume);
  if (readOnly) args.push('--mode', 'plan');
  else args.push('--force'); // con -p y sin --force los comandos de shell quedan bloqueados
  args.push(prompt);
  return { cmd: l.cmd, args: [...l.pre, ...args], parse: parseCursor, env: { CURSOR_INVOKED_AS: 'cursor-agent' } };
}

function parseOpencode(stdout) {
  let session_id; const texts = []; const errors = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    session_id ||= ev.sessionID;
    if (ev.type === 'text' && ev.part?.text) texts.push(ev.part.text);
    if (ev.type === 'error') errors.push(ev.error?.data?.message || ev.error?.name || 'error');
  }
  // El último bloque de texto es la respuesta final; lo anterior es narración.
  const result = errors.length ? errors.join('\n') : (texts.at(-1) ?? '').trim();
  return { is_error: errors.length > 0 || !result, result: result || 'OpenCode no devolvió texto.', session_id };
}

function parseCursor(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim()).reverse();
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j && typeof j === 'object' && (j.type === 'result' || 'result' in j)) {
        return { is_error: Boolean(j.is_error), result: String(j.result ?? ''), session_id: j.session_id || j.chatId };
      }
    } catch { /* línea no JSON */ }
  }
  return { is_error: true, result: stdout.trim().slice(-2000) || 'Cursor no devolvió JSON.' };
}

// ---- Codex: passthrough -----------------------------------------------------
// agent-rack ya parsea el JSONL de `codex exec --json`. Solo resolvemos el binario y
// reordenamos `resume exec ...` -> `exec resume ...` (así arma agent-rack el resume
// cuando el primer arg configurado es este script).
function runCodex(argv) {
  const l = resolve('codex', 'CODEX_BIN');
  if (!l) { process.stderr.write('No encontré Codex en el PATH (npm i -g @openai/codex o define CODEX_BIN).\n'); process.exit(127); }
  const args = argv[0] === 'resume' && argv[1] === 'exec' ? ['exec', 'resume', ...argv.slice(2)] : argv;
  const child = spawn(l.cmd, [...l.pre, ...args], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
  child.on('error', (e) => { process.stderr.write(`No pude iniciar codex: ${e.message}\n`); process.exit(127); });
  child.on('close', (code) => process.exit(code ?? 1));
}

function writeLog(spec, code, out, err) {
  if (process.env.AGENT_SHIM_NO_LOG) return;
  try {
    const logDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, `last-${target}.log`),
      `cwd=${process.cwd()}\ncmd=${spec.cmd} ${spec.args.slice(0, -1).join(' ')} <prompt>\nexit=${code}\n--- stdout\n${out}\n--- stderr\n${err}`);
  } catch { /* el log es opcional */ }
}

// ---- main -------------------------------------------------------------------
if (target === 'codex') {
  runCodex(rest);
} else if (target === 'resume' && rest[0] === 'codex') {
  // agent-rack inserta `resume` justo después del primer arg (este script).
  runCodex(['resume', ...rest.slice(1)]);
} else {
  const spec = target === 'opencode' ? opencodeSpec()
    : target === 'cursor' ? cursorSpec()
    : fail(`Agente desconocido: ${target}. Usa codex | opencode | cursor.`);
  const child = spawn(spec.cmd, spec.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(spec.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
  child.on('error', (e) => fail(`No pude iniciar ${target}: ${e.message}`));
  child.on('close', (code) => {
    writeLog(spec, code, out, err);
    const r = spec.parse(out);
    if (r.is_error && err.trim()) r.result += `\n\nstderr:\n${err.trim().slice(-1500)}`;
    emit(r, r.is_error ? (code || 1) : 0);
  });
}
