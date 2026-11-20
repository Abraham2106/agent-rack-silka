import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardRemoteClient } from 'agent-rack/dist/cli/dashboard/remoteClient.js';
import { DEFAULT_SSE_PORT } from 'agent-rack/dist/config/schema.js';
import { tokenFilePath } from 'agent-rack/dist/security/auth.js';
import { withFileLock, writeAtomic } from './lock.mjs';
import { signalProcessTree } from './proc.mjs';

export const HUB_HINT = 'corre: silka hub';

export class HubError extends Error {
  constructor(detail) {
    super(detail ? `No hay hub. ${HUB_HINT} (${detail})` : `No hay hub. ${HUB_HINT}`);
    this.name = 'HubError';
  }
}

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function loadSilkaConfig() {
  const root = repoRoot();
  const configPath = path.join(root, 'agent-rack.config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Falta agent-rack.config.json. Corre: npm run setup');
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo leer ${configPath}: ${detail}`);
  }
  const port = Number.isInteger(config.port) ? config.port : DEFAULT_SSE_PORT;
  const agents = Object.keys(config.agents ?? {});
  return { root, configPath, config, port, agents };
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function readRuntime(port) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenFilePath(port), 'utf8'));
    const pid = Number(parsed?.pid);
    if (typeof parsed?.token !== 'string' || !parsed.token || !Number.isInteger(pid)) return null;
    return { port: Number(parsed.port) || port, token: parsed.token, pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function promptsFile(port) {
  return path.join(path.dirname(tokenFilePath(port)), 'silka-prompts.json');
}

function readPromptFile(port) {
  try {
    const parsed = JSON.parse(fs.readFileSync(promptsFile(port), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeMeta(value) {
  if (typeof value === 'string') return { prompt: value, model: '', steeredFrom: '' };
  if (value && typeof value === 'object') {
    return {
      prompt: String(value.prompt ?? ''),
      model: String(value.model ?? ''),
      steeredFrom: String(value.steeredFrom ?? ''),
    };
  }
  return { prompt: '', model: '', steeredFrom: '' };
}

export function readMeta(port) {
  const raw = readPromptFile(port);
  const meta = {};
  for (const [id, value] of Object.entries(raw)) meta[id] = normalizeMeta(value);
  return meta;
}

export function readPrompts(port) {
  const meta = readMeta(port);
  return Object.fromEntries(Object.entries(meta).map(([id, item]) => [id, item.prompt]));
}

export function rememberSession(port, sessionId, fields) {
  if (!sessionId) return;
  const file = promptsFile(port);
  withFileLock(`${file}.lock`, () => {
    const all = readPromptFile(port);
    const prev = normalizeMeta(all[sessionId]);
    all[sessionId] = {
      prompt: fields.prompt !== undefined ? String(fields.prompt) : prev.prompt,
      model: fields.model !== undefined ? String(fields.model) : prev.model,
      steeredFrom: fields.steeredFrom !== undefined ? String(fields.steeredFrom) : prev.steeredFrom,
    };
    writeAtomic(file, `${JSON.stringify(all)}\n`);
  });
}

export function rememberPrompt(port, sessionId, prompt) {
  rememberSession(port, sessionId, { prompt });
}

export function hubStatus() {
  const cfg = loadSilkaConfig();
  const runtime = readRuntime(cfg.port);
  const alive = Boolean(runtime && pidAlive(runtime.pid));
  return {
    ...cfg,
    runtime,
    alive,
    url: `http://127.0.0.1:${cfg.port}/sse`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Arranca el hub separado de este proceso si no hay uno vivo, y espera el token. */
export async function ensureHub() {
  const current = hubStatus();
  if (current.alive && current.runtime?.token) return current;
  const bin = path.join(current.root, 'node_modules', 'agent-rack', 'bin', 'agent-rack.js');
  const child = spawn(process.execPath, [bin, 'start', '-t', 'sse', '-c', current.configPath], {
    cwd: current.root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = hubStatus();
    if (status.alive && status.runtime?.token) return status;
    await sleep(250);
  }
  throw new HubError('el hub no respondió a tiempo');
}

export async function startHub() {
  const status = hubStatus();
  if (status.alive) {
    console.log(`Hub ya está en marcha en http://127.0.0.1:${status.port} (pid ${status.runtime.pid}).`);
    return;
  }
  const bin = path.join(status.root, 'node_modules', 'agent-rack', 'bin', 'agent-rack.js');
  console.log(`Arrancando hub en http://127.0.0.1:${status.port}/sse`);
  const child = spawn(process.execPath, [bin, 'start', '-t', 'sse', '-c', status.configPath], {
    cwd: status.root,
    stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) process.exitCode = code;
      resolve();
    });
    const stop = () => {
      signalProcessTree(child.pid);
      const force = setTimeout(() => signalProcessTree(child.pid, { force: true }), 2000);
      child.once('exit', () => clearTimeout(force));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.platform === 'win32') process.once('SIGBREAK', stop);
  });
}

export async function withClient(fn) {
  const status = hubStatus();
  if (!status.alive || !status.runtime?.token) throw new HubError();
  const client = new DashboardRemoteClient(status.url, status.runtime.token);
  try {
    await client.connect();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new HubError(detail);
  }
  try {
    return await fn(client, status);
  } finally {
    await client.close().catch(() => {});
  }
}
