// Mide el TUI en un pty real: tiempo hasta el primer píxel (pantalla de carga), hasta el
// TUI listo y la latencia de eco de teclas (lo que se siente como "lento").
//   node scripts/tui-timing.mjs [--keys 10]
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pty = createRequire(import.meta.url)(path.join(root, 'node_modules', 'node-pty'));
const keys = Number(process.argv[process.argv.indexOf('--keys') + 1]) || 10;
const env = { ...process.env, COLORTERM: 'truecolor', FORCE_COLOR: '3' };
delete env.CI;

const t0 = performance.now();
const p = pty.spawn(process.execPath, [path.join(root, 'src/silka/cli.mjs'), 'ui'], { cols: 120, rows: 35, cwd: root, env, name: 'xterm-256color' });
let out = '';
let firstOut = 0;
let ready = 0;
const waiters = [];
p.onData((d) => {
  out += d;
  if (!firstOut && d.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim()) firstOut = performance.now() - t0;
  if (!ready && /q sale/.test(out)) ready = performance.now() - t0;
  for (const w of [...waiters]) if (w.test(out)) { waiters.splice(waiters.indexOf(w), 1); w.done(); }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (re, ms = 5000) => new Promise((resolve) => {
  const w = { test: (s) => re.test(s), done: () => resolve(true) };
  waiters.push(w);
  setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(false); } }, ms);
});

await until(/q sale/, 60_000);
await wait(1500);
const lat = [];
const letters = 'wzjxkvbpyu';
for (let i = 0; i < keys; i += 1) {
  const ch = letters[i % letters.length];
  const mark = out.length;
  const t = performance.now();
  p.write(ch);
  const ok = await new Promise((resolve) => {
    const w = { test: (s) => s.slice(mark).includes(ch), done: () => resolve(true) };
    waiters.push(w);
    setTimeout(() => resolve(false), 3000);
  });
  lat.push(ok ? performance.now() - t : 3000);
  await wait(250 + Math.random() * 400);
}
p.write('\x1b');
await wait(200);
p.write('\x03');
await wait(300);
try { p.kill(); } catch { /* ya salió */ }
lat.sort((a, b) => a - b);
const r = (n) => Math.round(n);
console.log(`primer contenido: ${r(firstOut)} ms`);
console.log(`TUI listo:        ${r(ready)} ms`);
console.log(`eco de tecla:     mediana ${r(lat[Math.floor(lat.length / 2)])} ms · peor ${r(lat[lat.length - 1])} ms (${lat.length} teclas)`);
process.exit(0);
