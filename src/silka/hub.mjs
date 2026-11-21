import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardRemoteClient } from 'agent-rack/dist/cli/dashboard/remoteClient.js';
import { DEFAULT_SSE_PORT } from 'agent-rack/dist/config/schema.js';
import { tokenFilePath } from 'agent-rack/dist/security/auth.js';
import { startQueueDispatcher } from './dispatch.mjs';
import { startMergeSupervisor } from './merge/supervisor.mjs';
import { startTaskSupervisor } from './tasks/supervisor.mjs';
import { withFileLock, writeAtomic } from './lock.mjs';
import { signalProcessTree } from './proc.mjs';
import { createHubLink, describeNetError } from './hub-link.mjs';

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
  const configPath = process.env.SILKA_CONFIG
    ? path.resolve(process.env.SILKA_CONFIG)
    : path.join(root, 'agent-rack.config.json');
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

/** Arranca `silka hub` (agent-rack + despachador) si no hay uno vivo, y espera el token. */
/**
 * Entorno sin variables del harness que lanzó a Silka (TH-11): si el hub nace dentro de
 * Claude Code, heredaría CLAUDE_CODE_* (token de mensajería, email, ids de cuenta) y CI,
 * y se los pasaría a cada sub-agente. Ningún agente las necesita.
 */
export function harnessFreeEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_AGENT_SDK_|^CLAUDE_PROJECT_DIR$|^CLAUDE_PID$|^CI$/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function ensureHub() {
  const current = hubStatus();
  if (current.alive && current.runtime?.token) return current;
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const env = harnessFreeEnv(process.env);
  // En Windows el hub necesita consola propia: sin ella, las terminales de los agentes
  // (Cursor) fallan con "Can't find Bash". Se abre minimizada con `start /min`.
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', 'start', '"silka hub"', '/min', `"${process.execPath}"`, `"${cli}"`, 'hub'], {
      cwd: current.root, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, env,
    })
    : spawn(process.execPath, [cli, 'hub'], { cwd: current.root, detached: true, stdio: 'ignore', env });
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
  const connectHub = async (runtime) => {
    const client = new DashboardRemoteClient(status.url, runtime.token);
    await client.connect();
    return client;
  };
  const stopDispatch = startQueueDispatcher({
    port: status.port,
    readRuntime: () => readRuntime(status.port),
    connect: connectHub,
  });
  const stopTasks = startTaskSupervisor({
    readRuntime: () => readRuntime(status.port),
    connect: connectHub,
  });
  const stopMerge = startMergeSupervisor({
    readRuntime: () => readRuntime(status.port),
    connect: connectHub,
  });
  const child = spawn(process.execPath, [bin, 'start', '-t', 'sse', '-c', status.configPath], {
    cwd: status.root,
    stdio: 'inherit',
    env: process.env,
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
  await stopDispatch();
  await stopTasks();
  await stopMerge();
}

/** Abre un cliente del hub leyendo el token vigente (cambia si el hub se reinició). */
export async function openHubClient() {
  const status = hubStatus();
  if (!status.alive || !status.runtime?.token) throw new HubError();
  const client = new DashboardRemoteClient(status.url, status.runtime.token);
  try {
    await client.connect();
  } catch (err) {
    await client.close().catch(() => {});
    throw new HubError(describeNetError(err));
  }
  return client;
}

export async function withClient(fn, { onState } = {}) {
  const status = hubStatus();
  if (!status.alive || !status.runtime?.token) throw new HubError();
  // Enlace que reconecta: si el hub se reinicia o la conexión SSE se cae, la siguiente
  // llamada abre otra en vez de fallar para siempre con "fetch failed".
  const client = createHubLink(openHubClient, { onState });
  await client.connect();
  try {
    return await fn(client, status);
  } finally {
    await client.close().catch(() => {});
  }
}
