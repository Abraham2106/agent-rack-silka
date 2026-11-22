import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';
export const GRAPH_TOOLS = 'query_graph, get_node, get_neighbors';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeout ?? 20_000,
    cwd: opts.cwd,
    shell: false,
  });
}

export function pythonCommand() {
  for (const cmd of IS_WIN ? ['python', 'py'] : ['python3', 'python']) {
    const result = run(cmd, ['--version']);
    const text = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status === 0 && /Python 3\.(\d+)/.test(text)) {
      const minor = Number(text.match(/Python 3\.(\d+)/)?.[1]);
      if (minor >= 10) return { cmd, version: text.trim().split(/\r?\n/)[0] };
    }
  }
  return null;
}

function scriptDirs() {
  const dirs = [];
  const home = os.homedir();
  if (IS_WIN) {
    const root = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
      : '';
    if (root && fs.existsSync(root)) {
      for (const name of fs.readdirSync(root)) {
        dirs.push(path.join(root, name, 'Scripts'));
      }
    }
    if (process.env.APPDATA) {
      const pyRoot = path.join(process.env.APPDATA, 'Python');
      dirs.push(path.join(pyRoot, 'Scripts'));
      if (fs.existsSync(pyRoot)) {
        for (const name of fs.readdirSync(pyRoot)) dirs.push(path.join(pyRoot, name, 'Scripts'));
      }
    }
  } else {
    dirs.push(path.join(home, '.local', 'bin'));
  }
  return dirs;
}

function commandOnPath(name) {
  const probe = IS_WIN ? 'where.exe' : 'which';
  const result = run(probe, [name]);
  if (result.status !== 0) return '';
  const found = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return found || '';
}

export function graphifyCommand() {
  const onPath = commandOnPath(IS_WIN ? 'graphify.exe' : 'graphify') || commandOnPath('graphify');
  if (onPath && fs.existsSync(onPath)) return { cmd: onPath, pre: [] };
  const file = IS_WIN ? 'graphify.exe' : 'graphify';
  for (const dir of scriptDirs()) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return { cmd: candidate, pre: [] };
  }
  const python = pythonCommand();
  if (!python) return null;
  const imported = run(python.cmd, ['-c', 'import graphify']);
  if (imported.status === 0) return { cmd: python.cmd, pre: ['-m', 'graphify'] };
  return null;
}

export function graphifyMcpCommand() {
  const onPath = commandOnPath(IS_WIN ? 'graphify-mcp.exe' : 'graphify-mcp') || commandOnPath('graphify-mcp');
  if (onPath && fs.existsSync(onPath)) return { cmd: onPath, pre: [] };
  const file = IS_WIN ? 'graphify-mcp.exe' : 'graphify-mcp';
  for (const dir of scriptDirs()) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return { cmd: candidate, pre: [] };
  }
  const python = pythonCommand();
  if (!python) return null;
  const imported = run(python.cmd, ['-c', 'import graphify.serve']);
  if (imported.status === 0) return { cmd: python.cmd, pre: ['-m', 'graphify.serve'] };
  return null;
}

export function graphJsonPath(workspace) {
  return path.join(path.resolve(workspace || process.cwd()), 'graphify-out', 'graph.json');
}

export function graphHint(workspace) {
  const file = graphJsonPath(workspace);
  if (!fs.existsSync(file)) return '';
  return `grafo: graphify-out/graph.json — ${GRAPH_TOOLS}`;
}

export function graphStatus(workspace = process.cwd()) {
  const dir = path.resolve(workspace);
  const bin = graphifyCommand();
  const graph = graphJsonPath(dir);
  const hasGraph = fs.existsSync(graph);
  if (!bin) {
    const python = pythonCommand();
    return {
      installed: false,
      hasGraph,
      graph,
      text: [
        'Graphify no está instalado.',
        'Silka funciona igual sin él.',
        python
          ? 'Para instalarlo: pip install --user graphifyy'
          : 'Hace falta Python 3.10+ y después: pip install --user graphifyy',
      ].join('\n'),
    };
  }
  const version = run(bin.cmd, [...bin.pre, '--version']);
  const versionText = `${version.stdout || ''}${version.stderr || ''}`.trim().split(/\r?\n/)[0] || 'instalado';
  const lines = [`Graphify: ${versionText}`];
  if (hasGraph) lines.push(`Grafo: ${graph}`, `Herramientas: ${GRAPH_TOOLS}`);
  else lines.push(`Grafo: no está en ${graph}`, 'Generarlo: silka graph build');
  return { installed: true, hasGraph, graph, text: lines.join('\n') };
}

export function installGraphify() {
  const python = pythonCommand();
  if (!python) throw new Error('No hay Python 3.10+. Graphify es opcional: silka sigue sin él.');
  const result = spawnSync(python.cmd, ['-m', 'pip', 'install', '--user', 'graphifyy'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('pip install --user graphifyy falló.');
  const bin = graphifyCommand();
  if (!bin) throw new Error('graphifyy se instaló, pero no encuentro el comando graphify.');
  return bin;
}

export function buildGraph(workspace = process.cwd()) {
  const dir = path.resolve(workspace);
  if (!fs.existsSync(dir)) throw new Error(`No existe el workspace ${dir}`);
  let bin = graphifyCommand();
  if (!bin) bin = installGraphify();
  const result = spawnSync(bin.cmd, [...bin.pre, 'extract', dir, '--code-only'], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('graphify no pudo generar el grafo.');
  return graphStatus(dir).text;
}

export function graphifyMcpLaunch(workspace = process.cwd()) {
  const graph = graphJsonPath(workspace);
  const mcp = graphifyMcpCommand();
  if (mcp) return { command: mcp.cmd, args: [...mcp.pre, graph] };
  const bin = graphifyCommand();
  if (!bin) return null;
  return { command: bin.cmd, args: [...bin.pre, '--mcp', graph] };
}
