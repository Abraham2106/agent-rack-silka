#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { managerNotes, notesSummary } from './notes.mjs';

export async function startMcp() {
  const server = new McpServer({ name: 'silka', version: '0.1.0' });
  server.registerTool('silka_notes', {
    description: 'Devuelve las notas no leídas que el usuario dejó en silka para el manager. Por defecto las marca como leídas.',
    inputSchema: {
      sessionId: z.string().optional().describe('Si se indica, solo las notas de esa sesión (acepta un id corto).'),
      markRead: z.boolean().optional().describe('Marca como leídas las notas devueltas. Por defecto true.'),
    },
  }, async ({ sessionId, markRead }) => {
    const body = sessionId
      ? managerNotes({ sessionId, markRead: markRead !== false })
      : notesSummary();
    return { content: [{ type: 'text', text: JSON.stringify(body) }] };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise((resolve) => {
    const done = () => resolve();
    transport.onclose = done;
    process.stdin.on('end', done);
    process.stdin.on('close', done);
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  startMcp().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
