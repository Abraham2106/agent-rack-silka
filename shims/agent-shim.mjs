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
import { readSilkaMark } from '../src/silka/mark.mjs';
import { silkaConfigDir } from '../src/silka/paths.mjs';
import { signalProcessTree } from '../src/silka/proc.mjs';
import { beginTurn, finishTurn, oneLine } from '../src/silka/state.mjs';

export { readSilkaMark };

const IS_WIN = process.platform === 'win32';
const RESULT_LIMIT = 2000;
const RESULT_NOTE = '…(recortado; ver silka logs)';

// ---- parseo de args estilo Claude Code --------------------------------------
const VALUE_FLAGS = new Set(['--model', '--resume', '--permission-mode', '--output-format']);

export function parseShimArgs(argv) {
  const opts = {};
  const positionals = [];
  const list = argv || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (VALUE_FLAGS.has(a)) { opts[a.slice(2)] = list[++i]; continue; }
    const eq = a.match(/^--(model|resume|permission-mode|output-format)=(.*)$/s);
    if (eq) { opts[eq[1]] = eq[2]; continue; }
    positionals.push(a);
  }
  return { opts, positionals, prompt: positionals.at(-1) ?? '' };
}

let opts = {};
let prompt = '';
let target = '';

function silkaChildEnv(agent, rawPrompt) {
  const mark = readSilkaMark(rawPrompt);
  const base = mark.depth == null ? Number(process.env.SILKA_DEPTH || 0) : mark.depth;
  const depth = Number.isFinite(base) ? base + 1 : 1;
  return { SILKA_DEPTH: String(depth), SILKA_AGENT: agent };
}

function attachTurn(agent, rawPrompt) {
  const mark = readSilkaMark(rawPrompt);
  const trusted = mark.depth != null;
  try {
    const turn = beginTurn({
      workspace: process.cwd(),
      agent,
      from: trusted ? (mark.from || 'tú') : (process.env.SILKA_AGENT || 'tú'),
      prompt: mark.prompt,
    });
    return { prompt: turn.prompt, turnId: turn.id };
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function closeTurn(turnId, status, summary) {
  if (!turnId) return;
  try {
    finishTurn({ workspace: process.cwd(), id: turnId, status, summary: oneLine(summary, 80) });
  } catch { /* el registro no debe tumbar al agente */ }
}

export function codexStep(item) {
  const itemType = String(item?.type || '');
  if (itemType === 'command_execution' || itemType === 'shell') {
    const command = item.command || item.cmd || '';
    return command ? `→ $ ${clipStep(command)}` : '→ $';
  }
  if (itemType === 'mcp_tool_call' || itemType === 'mcp') {
    const server = item.server || item.mcp || '';
    const tool = item.tool || item.name || item.tool_name || '';
    const label = [server, tool].filter(Boolean).join('.');
    return `→ mcp ${label || 'tool'}`;
  }
  const name = String(item?.name || item?.tool || '');
  if (itemType === 'function_call' || itemType === 'tool_call' || itemType === 'local_shell_call') {
    if (/shell|bash|command/.test(name) || item.command) return `→ $ ${clipStep(item.command || name)}`;
    if (/mcp/i.test(name)) return `→ mcp ${clipStep(name, 60)}`;
    return name ? `→ ${clipStep(name, 60)}` : '';
  }
  if (itemType === 'file_change' && Array.isArray(item.changes)) {
    const file = item.changes.map((change) => change?.path).find(Boolean) || '';
    return file ? `→ edit ${clipStep(file)}` : '';
  }
  if (itemType === 'web_search') return item.query ? `→ search ${clipStep(item.query, 60)}` : '';
  return '';
}

/** El stdout de Codex se queda con el hilo y el mensaje final. El resto sale como paso. */
export function classifyCodexEvent(data) {
  if (!data || typeof data !== 'object') return { keep: false, step: '' };
  const type = String(data.type || '');
  if (type === 'thread.started' || type === 'error' || type === 'turn.failed') return { keep: true, step: '' };
  if (type !== 'item.started' && type !== 'item.completed') return { keep: false, step: '' };
  const item = data.item || {};
  if (String(item.type || '') === 'agent_message') {
    return type === 'item.completed' ? { keep: false, step: '', final: true } : { keep: false, step: '' };
  }
  const step = type === 'item.started' ? '' : codexStep(item);
  return { keep: false, step };
}

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

function pencilLine(text) {
  const clean = String(text ?? '').replace(/[ \t]+/g, ' ').trim();
  return clean ? [`✎ ${clean}`] : [];
}

/** Junta los deltas hasta un salto de línea. El corte a media palabra queda para el flush de la pausa. */
function takeText(state, chunk) {
  if (!chunk) return [];
  if (state.acc && chunk.startsWith(state.acc)) state.acc = chunk;
  else state.acc += chunk;
  const lines = [];
  let fresh = state.acc.slice(state.at);
  let newline = fresh.indexOf('\n');
  while (newline >= 0) {
    lines.push(...pencilLine(fresh.slice(0, newline)));
    state.at += newline + 1;
    fresh = state.acc.slice(state.at);
    newline = fresh.indexOf('\n');
  }
  return lines;
}

function flushText(state) {
  const lines = pencilLine(state.acc.slice(state.at));
  state.at = state.acc.length;
  return lines;
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
    return takeText(state, ev.part.text);
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
    const msg = opencodeErrorText(ev);
    state.errors.push(msg);
    return [`✗ ${clipStep(clarifyErrorText('opencode', state.model, msg), 120)}`];
  }
  return [];
}

function scanCursorResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter((line) => line.trim()).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.type === 'result' && typeof parsed.result === 'string') {
        return parsed.result;
      }
    } catch { /* línea no JSON */ }
  }
  return '';
}

function opencodeErrorText(ev) {
  const err = ev?.error;
  const found = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) found.push(value.trim());
  };
  if (typeof err === 'string') push(err);
  if (err && typeof err === 'object') {
    push(err.data?.message);
    push(err.message);
    if (typeof err.data === 'string') push(err.data);
    if (typeof err.name === 'string' && !/^error$/i.test(err.name)) push(err.name);
  }
  push(ev?.message);
  push(ev?.data?.message);
  return found.find((item) => !/^error$/i.test(item)) || found[0] || 'error';
}

/** Un "error" pelado con modelo pedido se dice claro. No se pega el stream. */
export function clarifyErrorText(agent, model, text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const vague = !raw || /^error\.?$/i.test(raw);
  const missing = /not found|does not exist|unknown model|invalid model|no such model|is not valid|isn't valid|not supported|not available|no existe/i.test(raw);
  if (model && (vague || missing)) return `modelo '${model}' no existe para ${agent}`;
  return raw || `error de ${agent}`;
}

export function capResult(text) {
  const clean = String(text ?? '').trim();
  if (clean.length <= RESULT_LIMIT) return clean;
  return `${clean.slice(0, RESULT_LIMIT - RESULT_NOTE.length)}${RESULT_NOTE}`;
}

export function finishCursor(state, stdout, err, model = '') {
  const result = typeof state.result === 'string' ? state.result : scanCursorResult(stdout);
  if (!result) {
    const last = String(err || '').split(/\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';
    return {
      is_error: true,
      result: capResult(clarifyErrorText('cursor', model, last || 'Cursor no devolvió JSON.')),
      session_id: state.session_id,
    };
  }
  const text = state.is_error ? clarifyErrorText('cursor', model, result) : result;
  return {
    is_error: Boolean(state.is_error),
    result: capResult(text),
    session_id: state.session_id,
  };
}

export function finishOpencode(state, model = '') {
  const raw = state.errors.length ? state.errors.at(-1) : (state.texts.at(-1) ?? '').trim();
  const text = state.errors.length
    ? clarifyErrorText('opencode', model, raw)
    : (raw || 'OpenCode no devolvió texto.');
  return {
    is_error: state.errors.length > 0 || !raw,
    result: capResult(text),
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
  if (opts['permission-mode'] === 'plan') args.push('--agent', 'plan');
  const turned = attachTurn('opencode', prompt);
  // OpenCode resuelve rutas relativas contra la raíz del repo git, no contra el cwd.
  const text = `[Directorio de trabajo: ${process.cwd()} (las rutas relativas son relativas a este directorio)]\n\n${turned.prompt}`;
  args.push(text);
  return {
    cmd: l.cmd,
    args: [...l.pre, ...args],
    kind: 'opencode',
    env: silkaChildEnv('opencode', prompt),
    turnId: turned.turnId,
    promptText: text,
    model: opts.model || '',
  };
}

export function cursorLaunchArgs({ model, resume, permissionMode, policy = 'workspace-write' } = {}) {
  const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust'];
  if (model) args.push('--model', model);
  if (resume) args.push('--resume', resume);
  const plan = permissionMode === 'plan' || policy === 'read-only';
  if (plan) args.push('--mode', 'plan');
  else if (policy === 'danger-full-access') args.push('--force');
  return args;
}

function executionPolicy() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'agent-rack.config.json'), 'utf8'));
    return config.security?.executionPolicy || 'workspace-write';
  } catch {
    return 'workspace-write';
  }
}

function cursorSpec() {
  const l = resolve('cursor-agent', 'CURSOR_AGENT_BIN');
  if (!l) fail('No encontré cursor-agent (instálalo con https://cursor.com/cli o define CURSOR_AGENT_BIN).');
  // stream-json emite cada herramienta al usarla. --stream-partial-output manda
  // el texto en deltas, así el ✎ aparece mientras el modelo escribe.
  // --force solo con danger-full-access. plan sigue siendo --mode plan.
  const args = cursorLaunchArgs({
    model: opts.model,
    resume: opts.resume,
    permissionMode: opts['permission-mode'],
    policy: executionPolicy(),
  });
  const turned = attachTurn('cursor', prompt);
  args.push(turned.prompt);
  return {
    cmd: l.cmd,
    args: [...l.pre, ...args],
    kind: 'cursor',
    env: { CURSOR_INVOKED_AS: 'cursor-agent', ...silkaChildEnv('cursor', prompt) },
    turnId: turned.turnId,
    promptText: turned.prompt,
    model: opts.model || '',
  };
}

// ---- Codex: passthrough -----------------------------------------------------
// agent-rack ya parsea el JSONL de `codex exec --json`. Solo resolvemos el binario y
// reordenamos `resume exec ...` -> `exec resume ...` (así arma agent-rack el resume
// cuando el primer arg configurado es este script).
function runCodex(argv) {
  const l = resolve('codex', 'CODEX_BIN');
  if (!l) { process.stderr.write('No encontré Codex en el PATH (npm i -g @openai/codex o define CODEX_BIN).\n'); process.exit(127); }
  const args = argv[0] === 'resume' && argv[1] === 'exec' ? ['exec', 'resume', ...argv.slice(2)] : [...argv];
  const rawPrompt = args.at(-1) ?? '';
  const turned = attachTurn('codex', rawPrompt);
  if (args.length) args[args.length - 1] = turned.prompt;
  const child = spawn(l.cmd, [...l.pre, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...silkaChildEnv('codex', rawPrompt) },
  });
  const held = { final: '', text: '' };
  let out = '';
  let err = '';
  let buf = '';
  const take = (line) => {
    let trimmed = line.replace(/\r$/, '');
    if (!trimmed.trim()) return;
    let data;
    try { data = JSON.parse(trimmed); } catch {
      const step = clipStep(trimmed, 120);
      if (step) process.stderr.write(`${step}\n`);
      err += `${step}\n`;
      return;
    }
    if (String(data.type || '') === 'error') {
      const model = modelFromArgs(args);
      const current = typeof data.message === 'string' ? data.message : '';
      const next = clarifyErrorText('codex', model, current || 'error');
      if (model && next !== current) {
        data = { ...data, message: next };
        trimmed = JSON.stringify(data);
      }
    }
    const kind = classifyCodexEvent(data);
    if (kind.final) {
      if (held.final) {
        const step = `✎ ${clipStep(held.text, 88)}`;
        process.stderr.write(`${step}\n`);
        err += `${step}\n`;
      }
      held.final = trimmed;
      held.text = String(data.item?.text || '');
      return;
    }
    if (kind.keep) {
      process.stdout.write(`${trimmed}\n`);
      out += `${trimmed}\n`;
    }
    if (kind.step) {
      process.stderr.write(`${kind.step}\n`);
      err += `${kind.step}\n`;
    }
  };
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    err += text;
    for (const line of text.split(/\n/)) {
      const step = clipStep(redactSecrets(line), 120);
      if (step) process.stderr.write(`${step}\n`);
    }
  });
  listenStop(child);
  child.on('error', (e) => { process.stderr.write(`No pude iniciar codex: ${e.message}\n`); process.exit(127); });
  whenAgentExits(child, (code) => {
    if (buf.trim()) take(buf);
    if (held.final) {
      process.stdout.write(`${held.final}\n`);
      out += `${held.final}\n`;
    }
    const status = code ? 'failed' : 'done';
    closeTurn(turned.turnId, status, held.text);
    writeLog({ cmd: l.cmd, args, promptText: turned.prompt, kind: 'codex' }, code, out, err);
    process.exit(code ?? 1);
  });
}

export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/nonce=[a-f0-9]{16,}/g, 'nonce=[redactado]')
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, '[redactado]')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redactado]')
    .replace(/\b(token|api[_-]?key|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[redactado]')
    .replace(/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}/g, '[redactado]');
}

function clipLog(text, max = 700_000) {
  const raw = String(text ?? '');
  if (raw.length <= max) return raw;
  return `…(log rotado, ${raw.length} caracteres)\n${raw.slice(-max)}`;
}

function writeLog(spec, code, out, err) {
  if (process.env.AGENT_SHIM_NO_LOG) return;
  try {
    const logDir = path.join(silkaConfigDir(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const name = spec.kind || target || 'agent';
    const file = path.join(logDir, `last-${name}.log`);
    const prev = `${file}.1`;
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(prev, { force: true });
        fs.renameSync(file, prev);
      } catch { /* se sobreescribe igual */ }
    }
    const body = redactSecrets([
      `cwd=${process.cwd()}`,
      `cmd=${spec.cmd} ${(spec.args || []).slice(0, -1).join(' ')} <prompt>`,
      `exit=${code}`,
      '--- prompt',
      String(spec.promptText || '').slice(0, 8000),
      '--- stdout',
      clipLog(out),
      '--- stderr',
      clipLog(err),
      '',
    ].join('\n'));
    fs.writeFileSync(file, body);
  } catch { /* el log es opcional */ }
}

function listenStop(child) {
  const stop = () => {
    signalProcessTree(child.pid);
    const force = setTimeout(() => signalProcessTree(child.pid, { force: true }), 2000);
    force.unref?.();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (IS_WIN) process.on('SIGBREAK', stop);
}

/** El fin es `exit` más un margen corto. `close` puede no llegar si un hijo deja el stdout abierto. */
function whenAgentExits(child, after) {
  let armed = false;
  const arm = (code) => {
    if (armed) return;
    armed = true;
    setTimeout(() => {
      signalProcessTree(child.pid, { force: true });
      setTimeout(() => after(code ?? 1), 50);
    }, 400);
  };
  child.on('exit', (code) => arm(code));
  child.on('close', (code) => arm(code));
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
  state.model = spec.model || '';
  let out = '';
  let err = '';
  let buf = '';
  let pause;
  const armPause = () => {
    clearTimeout(pause);
    if (!state.acc.slice(state.at).trim()) return;
    pause = setTimeout(() => publish(state, flushText(state)), 450);
    pause.unref?.();
  };
  const feed = (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const lines = spec.kind === 'cursor' ? onCursorEvent(ev, state) : onOpencodeEvent(ev, state);
    publish(state, lines);
    armPause();
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
  listenStop(child);
  child.on('error', (e) => fail(`No pude iniciar ${target}: ${e.message}`));
  whenAgentExits(child, (code) => {
    clearTimeout(pause);
    if (buf.trim()) feed(buf);
    clearTimeout(pause);
    publish(state, flushText(state));
    writeLog(spec, code, out, err);
    const result = spec.kind === 'cursor'
      ? finishCursor(state, out, err, spec.model)
      : finishOpencode(state, spec.model);
    closeTurn(spec.turnId, result.is_error ? 'failed' : 'done', result.result);
    emit(result, result.is_error ? (code || 1) : 0);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

// ---- main -------------------------------------------------------------------
function modelFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--model' || args[i] === '-m') && args[i + 1] && !String(args[i + 1]).startsWith('-')) return args[i + 1];
    const eq = String(args[i] || '').match(/^--model=(.*)$/);
    if (eq?.[1]) return eq[1];
  }
  return '';
}

if (isDirectRun()) {
  const [name, ...rest] = process.argv.slice(2);
  target = name;
  const parsed = parseShimArgs(rest);
  opts = parsed.opts;
  prompt = parsed.prompt;
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
