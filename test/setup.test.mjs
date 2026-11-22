// `silka setup`: ST-01..ST-05. Todo corre en directorios temporales: ninguna prueba toca
// ~/.config/silka, ~/.claude, ~/.codex ni la config global de agent-rack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup } from '../src/silka/setup/index.mjs';
import { lineDiff } from '../src/silka/setup/diff.mjs';
import { detectAgents } from '../src/silka/agents/detect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../src/silka/cli.mjs');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `silka-setup-${name}-`));

function fixture({ withCursor = false, withCodex = true } = {}) {
  const bin = tmp('bin');
  if (withCodex) fs.writeFileSync(path.join(bin, 'codex'), '');
  if (withCursor) fs.writeFileSync(path.join(bin, 'cursor-agent'), '');
  const home = tmp('home');
  // Config global simulada: debe quedar intacta tras cualquier ejecución de setup.
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"global":true}\n');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "x"\n');
  const configDir = tmp('cfg');
  const deps = {
    env: { PATH: bin },
    home,
    configDir,
    loadConfig: () => ({
      root: '/repo',
      configPath: '/repo/agent-rack.config.json',
      port: 8987,
      config: { port: 8987, agents: { codex: { command: 'node', args: ['shim.mjs', 'codex'] } } },
    }),
    bridge: () => ({ command: 'node', args: ['cli.mjs', 'bridge'] }),
  };
  return { deps, home, configDir, bin };
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

test('ST-01 agente ausente (cursor sin PATH) se lista como no instalado y no se intenta instalarlo', () => {
  const { deps } = fixture({ withCodex: true, withCursor: false });
  const r = runSetup([], deps);
  assert.equal(r.exitCode, 0);
  const cursor = r.json.agents.find((a) => a.agent === 'cursor');
  const codex = r.json.agents.find((a) => a.agent === 'codex');
  assert.equal(cursor.installed, false);
  assert.equal(codex.installed, true);
  assert.match(r.text, /cursor\s+no instalado/);
});

test('ST-01 detección: cursor se reconoce con cursor-agent en el PATH', () => {
  const { deps } = fixture({ withCursor: true });
  const [cursor] = detectAgents([{ agent: 'cursor', bin: ['cursor-agent', 'agent'] }], { env: deps.env, home: deps.home });
  assert.equal(cursor.installed, true);
  assert.equal(cursor.bin, 'cursor-agent');
  assert.equal(cursor.session, null);
});

test('ST-02 sin banderas es vista previa: imprime el diff y no escribe nada', () => {
  const { deps, configDir } = fixture();
  const before = snapshot(configDir);
  const r = runSetup([], deps);
  assert.equal(r.json.applied, false);
  assert.ok(r.json.changes.some((c) => c.action === 'crear' && c.diff.length > 0));
  assert.match(r.text, /Vista previa/);
  assert.deepEqual(snapshot(configDir), before);
  assert.deepEqual(fs.readdirSync(configDir), []);
});

test('ST-03 --apply escribe solo bajo la carpeta de config de Silka y deja intacta la config global simulada', () => {
  const { deps, configDir, home } = fixture();
  const globalBefore = snapshot(home);
  const r = runSetup(['--apply'], deps);
  assert.equal(r.exitCode, 0);
  assert.equal(r.json.applied, true);
  const written = Object.keys(snapshot(configDir)).sort();
  assert.deepEqual(written, ['agent-rack.effective-8987.json', 'bridge-mcp.json']);
  assert.deepEqual(snapshot(home), globalBefore);
});

test('ST-04 segunda ejecución con --apply no cambia nada y lo dice', async () => {
  const { deps, configDir } = fixture();
  runSetup(['--apply'], deps);
  const file = path.join(configDir, 'bridge-mcp.json');
  const mtime = fs.statSync(file).mtimeMs;
  const content = fs.readFileSync(file, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const r = runSetup(['--apply'], deps);
  assert.equal(r.json.applied, false);
  assert.match(r.text, /Sin cambios/);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
});

test('ST-05 --json devuelve agentes, cambios y applied; la salida por CLI es solo JSON', () => {
  const { deps } = fixture();
  const r = runSetup(['--json'], deps);
  assert.deepEqual(Object.keys(r.json).sort(), ['agents', 'applied', 'changes']);
  assert.ok(Array.isArray(r.json.agents) && Array.isArray(r.json.changes));
  // Por CLI real: stdout debe ser JSON válido y nada más. Config y directorios temporales.
  const { configDir } = deps;
  const cfg = path.join(tmp('cliconf'), 'agent-rack.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ port: 8987, agents: {} }));
  const out = spawnSync(process.execPath, [cli, 'setup', '--json'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      SILKA_CONFIG: cfg,
      SILKA_CONFIG_DIR: configDir,
      SILKA_DATA_DIR: tmp('data'),
    },
  });
  assert.equal(out.status, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.applied, false);
  assert.deepEqual(fs.readdirSync(configDir), []);
});

test('ST-03 --apply y --dry-run juntos se rechazan sin escribir', () => {
  const { deps, configDir } = fixture();
  const r = runSetup(['--apply', '--dry-run'], deps);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(fs.readdirSync(configDir), []);
});

test('diff por líneas marca quitadas y añadidas', () => {
  assert.deepEqual(lineDiff('a\nb\n', 'a\nb\n'), []);
  assert.deepEqual(lineDiff('a\nb', 'a\nc'), ['  a', '- b', '+ c']);
});
