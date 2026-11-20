import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { sseTransportInit } from 'agent-rack/dist/security/auth.js';
import { ensureHub } from './hub.mjs';
import { unreadNotes } from './notes.mjs';
import { rememberOrigin } from './origin.mjs';

const SILKA_MARK = /^\[silka depth=\d+ from=[^\]]*\]\s*/;

const NOTES_TOOL = {
  name: 'silka_notes',
  description: 'Devuelve las notas no leídas que el usuario dejó en silka para el manager. Por defecto las marca como leídas.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Si se indica, solo las notas de esa sesión (acepta un id corto).',
      },
      markRead: {
        type: 'boolean',
        description: 'Marca como leídas las notas devueltas. Por defecto true.',
      },
    },
  },
};

export function currentDepth() {
  const value = Number(process.env.SILKA_DEPTH ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function maxDepth() {
  const value = Number(process.env.SILKA_MAX_DEPTH ?? 2);
  return Number.isFinite(value) ? Math.floor(value) : 2;
}

export function isDelegatingTool(name) {
  return name === 'agent_run'
    || name === 'agent_session_create'
    || name === 'agent_review'
    || /_run$/.test(name);
}

export function depthBlockMessage() {
  const depth = currentDepth();
  const max = maxDepth();
  return `No se puede delegar: SILKA_DEPTH=${depth} ya alcanzó el máximo (${max}). Un sub-agente no lanza otro.`;
}

export function callerFrom(clientInfo) {
  const name = String(clientInfo?.name ?? '').trim();
  if (name) return name.replace(/[\[\]]/g, '');
  const agent = String(process.env.SILKA_AGENT ?? '').trim();
  if (agent) return agent.replace(/[\[\]]/g, '');
  return 'tú';
}

export function stampPrompt(prompt, depth, from) {
  const clean = String(prompt ?? '').replace(SILKA_MARK, '');
  return `[silka depth=${depth} from=${from}] ${clean}`;
}

function stampArgs(name, args, depth, from) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args || {};
  if (typeof args.prompt !== 'string') return { ...args };
  if (name !== 'agent_run' && name !== 'agent_session_create' && !/_run$/.test(name)) return { ...args };
  return { ...args, prompt: stampPrompt(args.prompt, depth, from) };
}

function callTimeout(args) {
  const seconds = Number(args?.timeoutSeconds);
  const base = Number.isFinite(seconds) && seconds > 0 ? seconds : 900;
  return Math.min(base + 30, 3600) * 1000;
}

function sessionIdsIn(value) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.sessionId === 'string' && node.sessionId) ids.add(node.sessionId);
    if (Array.isArray(node)) node.forEach(visit);
  };
  visit(value);
  return ids;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function hubSessionIds(hub) {
  const result = await hub.callTool({ name: 'agent_session_list', arguments: {} }, undefined, { timeout: 20_000 });
  const text = result.content?.find((item) => item.type === 'text')?.text ?? '[]';
  const parsed = parseJson(text);
  return sessionIdsIn(Array.isArray(parsed) ? parsed : []);
}

function rememberNewSessions(before, after, resultText, from, depth) {
  const ids = new Set(after);
  for (const id of sessionIdsIn(parseJson(resultText))) ids.add(id);
  for (const id of ids) {
    if (before.has(id)) continue;
    rememberOrigin(id, { from, depth });
  }
}

export async function startBridge() {
  const status = await ensureHub();
  const hub = new Client({ name: 'silka-bridge', version: '0.1.0' });
  const sse = new SSEClientTransport(new URL(status.url), sseTransportInit(status.runtime.token));
  await hub.connect(sse);
  const listed = await hub.listTools(undefined, { timeout: 20_000 });
  const hubTools = listed.tools ?? [];
  const tools = [...hubTools.filter((tool) => tool.name !== 'silka_notes'), NOTES_TOOL];

  const server = new Server({ name: 'agent-rack', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const blocked = currentDepth() >= maxDepth();
    return {
      tools: tools
        .filter((tool) => !blocked || !isDelegatingTool(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    if (name === 'silka_notes') {
      const notes = unreadNotes({ sessionId: args.sessionId, markRead: args.markRead !== false });
      return { content: [{ type: 'text', text: JSON.stringify(notes) }] };
    }
    if (isDelegatingTool(name) && currentDepth() >= maxDepth()) {
      return { content: [{ type: 'text', text: depthBlockMessage() }], isError: true };
    }
    const known = tools.some((tool) => tool.name === name);
    if (!known) {
      return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true };
    }
    const from = callerFrom(server.getClientVersion());
    const depth = currentDepth();
    const stamped = stampArgs(name, args, depth, from);
    let before = new Set();
    if (isDelegatingTool(name)) {
      try { before = await hubSessionIds(hub); } catch { /* el diff es un respaldo */ }
    }
    const result = await hub.callTool({ name, arguments: stamped }, undefined, { timeout: callTimeout(stamped) });
    if (isDelegatingTool(name) && !result.isError) {
      const text = result.content?.map((item) => item.text || '').join('\n') ?? '';
      try {
        const after = await hubSessionIds(hub);
        rememberNewSessions(before, after, text, from, depth);
      } catch {
        rememberNewSessions(before, before, text, from, depth);
      }
    }
    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise((resolve) => {
    const done = () => resolve();
    transport.onclose = done;
    process.stdin.on('end', done);
    process.stdin.on('close', done);
  });
  await hub.close().catch(() => {});
}
