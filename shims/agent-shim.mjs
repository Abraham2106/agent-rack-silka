#!/usr/bin/env node
// agent-shim: puente entre agent-rack y los CLIs de Codex, OpenCode y Cursor.
//
//   node agent-shim.mjs codex exec --json ... <prompt>        -> passthrough a `codex`
//   node agent-shim.mjs opencode [--model m] [--resume id] [--permission-mode m] <prompt>
//   node agent-shim.mjs cursor   [--model m] [--resume id] [--permission-mode m] <prompt>
//
// OpenCode y Cursor se traducen al protocolo JSON de Claude Code (transporte
// `claude_stream_json` de agent-rack). stdout queda en una sola línea final:
//   {"type":"result","is_error":bool,"result":"...","session_id":"..."}
// Cada paso se escribe al momento en stderr, en una línea corta (`→ read a.ts`,
// `→ $ npm test`, `✎ texto`). agent-rack guarda ese stderr como evento de
// estado y no lo mete en el resumen.
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

function activity(line) {
  const text = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  process.stderr.write(`${text}\n`);
}

function clipStep(value, max = 88) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

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

// ---- actividad en vivo ------------------------------------------------------
function verbFromName(name) {
  const low = String(name || '').replace(/ToolCall$/, '').toLowerCase();
  if (/shell|bash|command|terminal/.test(low)) return '$';
  if (/edit|patch|strreplace|search_replace|apply/.test(low)) return 'edit';
  if (/write|create/.test(low)) return 'write';
  if (/delete|remove/.test(low)) return 'delete';
  if (/read|view|cat|open/.test(low)) return 'read';
  if (/grep|semsearch|search/.test(low)) return 'search';
  if (/glob|^ls$|list|dir/.test(low)) return 'list';
  return low || 'tool';
}

function prettyPath(file) {
  const cwd = process.cwd().replaceAll('\\', '/').replace(/\/$/, '');
  const norm = String(file ?? '').replaceAll('\\', '/');
  if (cwd && norm.toLowerCase().startsWith(cwd.toLowerCase())) {
    return norm.slice(cwd.length).replace(/^\//, '') || '.';
  }
  return norm;
}

function fileOf(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj.path || obj.filePath || obj.file_path || obj.target_file || obj.target
    || obj.file || obj.uri || obj.targetDirectory || obj.target_directory || '';
}

function commandOf(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const command = obj.command || obj.cmd || '';
  return typeof command === 'string' ? command : '';
}

export function stepFromTool(name, args) {
  const verb = verbFromName(name);
  const file = fileOf(args);
  const command = commandOf(args);
  if (verb === '$' || command) {
    const cmd = clipStep(command);
    return cmd ? `→ $ ${cmd}` : '';
  }
  if (file) {
    const glob = args && typeof args === 'object' ? (args.globPattern || args.glob || '') : '';
    const suffix = glob && glob !== '*' && glob !== '**/*' ? ` ${clipStep(glob, 24)}` : '';
    return `→ ${verb} ${clipStep(prettyPath(file))}${suffix}`;
  }
  const extra = args && typeof args === 'object'
    ? (args.pattern || args.query || args.globPattern || args.glob || args.search || args.title || '')
    : '';
  const bit = clipStep(extra, 70);
  if (bit) return `→ ${verb} ${bit}`;
  return verb && verb !== 'tool' ? `→ ${verb}` : '';
}

function cursorToolLine(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return '';
  if (typeof toolCall.name === 'string') {
    return stepFromTool(toolCall.name, toolCall.args || toolCall.arguments || toolCall.input || {});
  }
  for (const [key, val] of Object.entries(toolCall)) {
    if (!val || typeof val !== 'object' || Array.isArray(val) || key === 'result') continue;
    if (!/toolcall$/i.test(key) && !val.args && !val.input && !val.arguments) continue;
    const args = val.args || val.arguments || val.input || {};
    const line = stepFromTool(key, args);
    if (line) return line;
  }
  return '';
}

function freshState() {
  return {
    calls: new Set(),
    texts: [],
    errors: [],
    session_id: undefined,
    result: undefined,
    is_error: false,
    acc: '',
    at: 0,
    last: '',
  };
}

function takeText(state, chunk) {
  if (!chunk) return [];
  if (state.acc && chunk.startsWith(state.acc)) state.acc = chunk;
  else state.acc += chunk;
  const fresh = state.acc.slice(state.at);
  const newline = fresh.indexOf('\n');
  if (newline >= 0) {
    const piece = clipStep(fresh.slice(0, newline), 72);
    state.at += newline + 1;
    return piece ? [`✎ ${piece}`] : [];
  }
  if (fresh.length < 72) return [];
  const piece = fresh.slice(0, 72).replace(/\s+/g, ' ').trim();
  state.at += 72;
  return piece ? [`✎ ${piece}`] : [];
}

function flushText(state) {
  const piece = clipStep(state.acc.slice(state.at), 72);
  state.acc = '';
  state.at = 0;
  return piece ? [`✎ ${piece}`] : [];
}

function rememberCall(state, id, line) {
  if (!line) return [];
  if (id && state.calls.has(id)) return [];
  if (id) state.calls.add(id);
  return [line];
}

/** Traduce un evento stream-json de Cursor a líneas de actividad. */
export function onCursorEvent(ev, state) {
  if (!ev || typeof ev !== 'object') return [];
  if (typeof ev.session_id === 'string' && ev.session_id) state.session_id = ev.session_id;
  else if (typeof ev.chatId === 'string' && ev.chatId) state.session_id ||= ev.chatId;
  const type = String(ev.type || '');
  if (type === 'result' || type === 'summary') {
    const lines = flushText(state);
    if (typeof ev.result === 'string') state.result = ev.result;
    else if (typeof ev.text === 'string' && state.result === undefined) state.result = ev.text;
    state.is_error = Boolean(ev.is_error) || ev.subtype === 'error';
    return lines;
  }
  if (type === 'tool_call') {
    const lines = flushText(state);
    const id = String(ev.call_id || ev.callId || ev.tool_call_id || '');
    const line = cursorToolLine(ev.tool_call) || stepFromTool(ev.name || '', ev.input || ev.args || {});
    lines.push(...rememberCall(state, id, line));
    return lines;
  }
  if (type === 'assistant' || type === 'message') {
    const content = ev.message?.content ?? ev.content ?? ev.text ?? ev.delta;
    const lines = [];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use' || block.type === 'tool_call') {
          lines.push(...flushText(state));
          const id = String(block.id || '');
          lines.push(...rememberCall(state, id, stepFromTool(block.name || block.tool || '', block.input || block.args || {})));
        } else if (block.type === 'text' || typeof block.text === 'string') {
          lines.push(...takeText(state, block.text || ''));
        }
      }
      return lines;
    }
    if (typeof content === 'string') return takeText(state, content);
  }
  return [];
}

/** Traduce un evento JSONL de OpenCode a líneas de actividad y acumula el texto final. */
export function onOpencodeEvent(ev, state) {
  if (!ev || typeof ev !== 'object') return [];
  state.session_id ||= ev.sessionID || ev.session_id;
  if (ev.type === 'text' && ev.part?.text) {
    state.texts.push(ev.part.text);
    const piece = clipStep(ev.part.text, 72);
    return piece ? [`✎ ${piece}`] : [];
  }
  if (ev.type === 'tool_use' || ev.type === 'tool') {
    const part = ev.part || ev;
    const status = part.state?.status;
    if (status === 'pending') return [];
    const id = String(part.id || part.callID || part.callId || '');
    const args = part.state?.input || part.input || {};
    const line = stepFromTool(part.tool || part.name || 'tool', args);
    return rememberCall(state, id, line);
  }
  if (ev.type === 'error') {
    const msg = ev.error?.data?.message || ev.error?.name || (typeof ev.error === 'string' ? ev.error : 'error');
    state.errors.push(String(msg));
    return [`✗ ${clipStep(msg, 72)}`];
  }
  return [];
}

function scanCursorResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter((line) => line.trim()).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && (parsed.type === 'result' || 'result' in parsed) && typeof parsed.result === 'string') {
        return parsed.result;
      }
    } catch { /* línea no JSON */ }
  }
  return '';
}

export function finishCursor(state, stdout, err) {
  const result = typeof state.result === 'string' ? state.result : scanCursorResult(stdout);
  let text = result || String(stdout || '').trim().slice(-2000) || 'Cursor no devolvió JSON.';
  if ((!result || state.is_error) && String(err || '').trim()) {
    text += `\n\nstderr:\n${String(err).trim().slice(-1500)}`;
  }
  return {
    is_error: Boolean(state.is_error) || !result,
    result: text,
    session_id: state.session_id,
  };
}

export function finishOpencode(state) {
  const result = state.errors.length ? state.errors.join('\n') : (state.texts.at(-1) ?? '').trim();
  return {
    is_error: state.errors.length > 0 || !result,
    result: result || 'OpenCode no devolvió texto.',
    session_id: state.session_id,
  };
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
  return { cmd: l.cmd, args: [...l.pre, ...args], kind: 'opencode' };
}

function cursorSpec() {
  const l = resolve('cursor-agent', 'CURSOR_AGENT_BIN');
  if (!l) fail('No encontré cursor-agent (instálalo con https://cursor.com/cli o define CURSOR_AGENT_BIN).');
  // stream-json emite cada herramienta al usarla. --stream-partial-output manda
  // el texto en deltas, así el ✎ aparece mientras el modelo escribe.
  const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.resume) args.push('--resume', opts.resume);
  if (readOnly) args.push('--mode', 'plan');
  else args.push('--force'); // con -p y sin --force los comandos de shell quedan bloqueados
  args.push(prompt);
  return { cmd: l.cmd, args: [...l.pre, ...args], kind: 'cursor', env: { CURSOR_INVOKED_AS: 'cursor-agent' } };
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

function publish(state, lines) {
  for (const line of lines) {
    if (!line || line === state.last) continue;
    state.last = line;
    activity(line);
  }
}

function runTranslated(spec) {
  const child = spawn(spec.cmd, spec.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(spec.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const state = freshState();
  let out = '';
  let err = '';
  let buf = '';
  const feed = (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const lines = spec.kind === 'cursor' ? onCursorEvent(ev, state) : onOpencodeEvent(ev, state);
    publish(state, lines);
  };
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    out += text;
    buf += text;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      feed(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  });
  // El stderr del CLI no se reenvía: el nuestro es solo la actividad corta.
  child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
  child.on('error', (e) => fail(`No pude iniciar ${target}: ${e.message}`));
  child.on('close', (code) => {
    if (buf.trim()) feed(buf);
    publish(state, flushText(state));
    writeLog(spec, code, out, err);
    const result = spec.kind === 'cursor' ? finishCursor(state, out, err) : finishOpencode(state);
    emit(result, result.is_error ? (code || 1) : 0);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

// ---- main -------------------------------------------------------------------
if (isDirectRun()) {
  if (target === 'codex') {
    runCodex(rest);
  } else if (target === 'resume' && rest[0] === 'codex') {
    // agent-rack inserta `resume` justo después del primer arg (este script).
    runCodex(['resume', ...rest.slice(1)]);
  } else if (target === 'opencode' || target === 'cursor') {
    runTranslated(target === 'opencode' ? opencodeSpec() : cursorSpec());
  } else {
    fail(`Agente desconocido: ${target}. Usa codex | opencode | cursor.`);
  }
}
