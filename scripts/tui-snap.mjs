// Captura el TUI tal cual se ve: lo corre en un pty, graba la salida ANSI y genera un HTML
// que la reproduce con xterm.js (un emulador de terminal real) para mirarla o fotografiarla.
//   node scripts/tui-snap.mjs <nombre> [--cols 120] [--rows 35] [--keys "n,DOWN,DOWN,ENTER,text:grok"] [--wait 4000]
// Teclas: ENTER, ESC, UP, DOWN, CTRL_B, o text:<texto>. Sale en docs/assets/tui-<nombre>.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pty = require(path.join(root, 'node_modules', 'node-pty'));

const [name = 'main', ...rest] = process.argv.slice(2);
const opt = { cols: 120, rows: 35, keys: '', wait: 4000 };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
const cols = Number(opt.cols); const rows = Number(opt.rows);

const ESC = String.fromCharCode(27);
const KEYS = { ENTER: '\r', ESC, UP: `${ESC}[A`, DOWN: `${ESC}[B`, CTRL_B: String.fromCharCode(2), TAB: '\t' };
const env = { ...process.env, COLORTERM: 'truecolor', FORCE_COLOR: '3' };
delete env.CI;

const p = pty.spawn(process.execPath, [path.join(root, 'src/silka/cli.mjs'), 'ui'], { cols, rows, cwd: root, env, name: 'xterm-256color' });
let out = '';
p.onData((d) => { out += d; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(Number(opt.wait));
for (const key of String(opt.keys || '').split(',').filter(Boolean)) {
  if (key.startsWith('text:')) for (const ch of key.slice(5)) { p.write(ch); await wait(120); }
  else p.write(KEYS[key] ?? key);
  await wait(700);
}
await wait(1200);
p.kill();

const html = `<!doctype html><html><head><meta charset="utf-8"><title>silka · ${name}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<style>html,body{margin:0;background:#0d0c11}#t{padding:16px;display:inline-block}</style></head>
<body><div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script>
const term = new Terminal({ cols: ${cols}, rows: ${rows}, fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 14, allowProposedApi: true,
  theme: { background: '#0d0c11', foreground: '#e7e5ee' } });
term.open(document.getElementById('t'));
term.write(${JSON.stringify(out)});
</script></body></html>`;
const file = path.join(root, 'docs', 'assets', `tui-${name}.html`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, html);
console.log(file);
process.exit(0);
