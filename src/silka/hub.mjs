import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardRemoteClient } from 'agent-rack/dist/cli/dashboard/remoteClient.js';
import { DEFAULT_SSE_PORT } from 'agent-rack/dist/config/schema.js';
import { tokenFilePath } from 'agent-rack/dist/security/auth.js';

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

export function readPrompts(port) {
  try {
    const parsed = JSON.parse(fs.readFileSync(promptsFile(port), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberPrompt(port, sessionId, prompt) {
  if (!sessionId) return;
  const all = readPrompts(port);
  all[sessionId] = String(prompt ?? '');
  const file = promptsFile(port);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(all)}\n`);
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
      if (!child.killed) child.kill();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
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
