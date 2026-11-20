import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { sseTransportInit } from 'agent-rack/dist/security/auth.js';
import { isBusy } from './format.mjs';
import { ensureHub } from './hub.mjs';
import { unreadNotes } from './notes.mjs';
import { originLabel, readOrigins, rememberOrigin } from './origin.mjs';
import { appendDecision, formatBlock, formatChanges, formatDecisions, samePath } from './state.mjs';

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

const WORKSPACE = {
  type: 'string',
  description: 'Ruta absoluta del workspace.',
};

const STATE_TOOLS = [
  {
    name: 'silka_state',
    description: 'Resumen compacto del estado del proyecto: rama, HEAD, cambios de otros agentes, tareas en curso y últimas decisiones.',
    inputSchema: {
      type: 'object',
      properties: { workspace: WORKSPACE },
      required: ['workspace'],
    },
  },
  {
    name: 'silka_changes',
    description: 'Archivos y resúmenes que registraron los agentes desde una fecha ISO. Sin since, usa las últimas 2 horas.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        since: { type: 'string', description: 'Fecha ISO. Por defecto, hace 2 horas.' },
      },
      required: ['workspace'],
    },
  },
  {
    name: 'silka_decide',
    description: 'Anota una decisión del proyecto con autor, fecha y sesión.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        text: { type: 'string', description: 'La decisión, en una frase.' },
      },
      required: ['workspace', 'text'],
    },
  },
  {
    name: 'silka_decisions',
    description: 'Últimas decisiones anotadas en el workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE,
        limit: { type: 'number', description: 'Cuántas devolver. Por defecto 10.' },
      },
      required: ['workspace'],
    },
  },
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text: String(text) }], ...(isError ? { isError: true } : {}) };
}

function workspaceOf(args) {
  const value = args?.workspace || args?.cwd || '';
  return value ? String(value) : '';
}

export function resolveLineage({ envDepth = 0, from, workspace, sessions = [], origins = {} }) {
  const label = originLabel(from);
  const running = sessions.filter((session) => {
    if (!isBusy(session.status)) return false;
    if (originLabel(session.agentId) !== label || label === 'tú') return false;
    if (workspace && session.workspace && !samePath(session.workspace, workspace)) return false;
    return true;
  }).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const parent = running[0] || null;
  const parentDepth = parent ? Number(origins[parent.sessionId]?.depth ?? 0) : 0;
  const depth = envDepth > 0 ? envDepth : (parent ? parentDepth + 1 : 0);
  return { depth, parentSessionId: parent?.sessionId || '' };
}

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

export function depthBlockMessage(depth = currentDepth()) {
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

function rememberNewSessions(before, after, resultText, from, depth, parentSessionId) {
  const ids = new Set(after);
  for (const id of sessionIdsIn(parseJson(resultText))) ids.add(id);
  for (const id of ids) {
    if (before.has(id)) continue;
    rememberOrigin(id, { from, depth, parentSessionId });
  }
}

async function hubSessions(hub) {
  const result = await hub.callTool({ name: 'agent_session_list', arguments: {} }, undefined, { timeout: 20_000 });
  const text = result.content?.find((item) => item.type === 'text')?.text ?? '[]';
  const parsed = parseJson(text);
  return Array.isArray(parsed) ? parsed : [];
}

function localTool(name, args, from, sessions) {
  const workspace = workspaceOf(args);
  if (!workspace) return textResult('Falta workspace.', true);
  if (name === 'silka_state') return textResult(formatBlock(workspace));
  if (name === 'silka_changes') {
    try { return textResult(formatChanges(workspace, args.since)); }
    catch (err) { return textResult(err instanceof Error ? err.message : String(err), true); }
  }
  if (name === 'silka_decide') {
    try {
      const parent = resolveLineage({ envDepth: 0, from, workspace, sessions, origins: readOrigins() });
      const row = appendDecision({
        workspace,
        text: args.text,
        author: from,
        sessionId: parent.parentSessionId,
      });
      return textResult(`${row.at} ${row.author}: ${row.text}`);
    } catch (err) {
      return textResult(err instanceof Error ? err.message : String(err), true);
    }
  }
  if (name === 'silka_decisions') return textResult(formatDecisions(workspace, args.limit));
  return null;
}

export async function startBridge() {
  const status = await ensureHub();
  const hub = new Client({ name: 'silka-bridge', version: '0.1.0' });
  const sse = new SSEClientTransport(new URL(status.url), sseTransportInit(status.runtime.token));
  await hub.connect(sse);
  const listed = await hub.listTools(undefined, { timeout: 20_000 });
  const hubTools = listed.tools ?? [];
  const tools = [
    ...hubTools.filter((tool) => tool.name !== 'silka_notes' && !tool.name.startsWith('silka_')),
    NOTES_TOOL,
    ...STATE_TOOLS,
  ];

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
    const from = callerFrom(server.getClientVersion());
    let sessions = [];
    let listed = false;
    if (name.startsWith('silka_') || isDelegatingTool(name)) {
      try {
        sessions = await hubSessions(hub);
        listed = true;
      } catch { /* el estado local no depende del hub */ }
    }
    const local = localTool(name, args, from, sessions);
    if (local) return local;
    const lineage = resolveLineage({
      envDepth: currentDepth(),
      from,
      workspace: workspaceOf(args),
      sessions,
      origins: readOrigins(),
    });
    if (isDelegatingTool(name) && lineage.depth >= maxDepth()) {
      return { content: [{ type: 'text', text: depthBlockMessage(lineage.depth) }], isError: true };
    }
    const known = tools.some((tool) => tool.name === name);
    if (!known) {
      return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true };
    }
    const stamped = stampArgs(name, args, lineage.depth, from);
    const before = new Set(sessions.map((session) => session.sessionId));
    const result = await hub.callTool({ name, arguments: stamped }, undefined, { timeout: callTimeout(stamped) });
    if (isDelegatingTool(name) && listed && !result.isError) {
      const text = result.content?.map((item) => item.text || '').join('\n') ?? '';
      try {
        const after = (await hubSessions(hub)).map((session) => session.sessionId);
        rememberNewSessions(before, after, text, from, lineage.depth, lineage.parentSessionId);
      } catch {
        rememberNewSessions(before, before, text, from, lineage.depth, lineage.parentSessionId);
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
