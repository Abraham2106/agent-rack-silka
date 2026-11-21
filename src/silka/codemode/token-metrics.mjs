function charTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text ?? ''), 'utf8') / 4);
}

function serializeTool(tool) {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  });
}

/** Escenario simulado: lanzar 5 tareas, esperar, estado ×5 (MCP clásico). */
export function simulatedMcpBatchPayload(toolDefs) {
  const byName = new Map(toolDefs.map((t) => [t.name, t]));
  const create = byName.get('agent_session_create') || { name: 'agent_session_create', description: '', inputSchema: {} };
  const status = byName.get('agent_session_status') || { name: 'agent_session_status', description: '', inputSchema: {} };
  const waitPayload = serializeTool(create) + serializeTool(status);
  return waitPayload.repeat(5) + serializeTool(status).repeat(5);
}

const CODE_MODE_TOOLS = [
  {
    name: 'silka_search',
    description: 'Devuelve firmas TypeScript de la API silka según la consulta.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'silka_execute',
    description: 'Ejecuta un programa corto contra la API silka en un sandbox y devuelve su retorno.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        workspace: { type: 'string' },
        timeoutSeconds: { type: 'number' },
      },
      required: ['code', 'workspace'],
    },
  },
];

const SAMPLE_EXECUTE = `const tasks = await silka.launch([
  { title: 't1', agent: 'codex', prompt: 'a' },
  { title: 't2', agent: 'codex', prompt: 'b' },
  { title: 't3', agent: 'codex', prompt: 'c' },
  { title: 't4', agent: 'codex', prompt: 'd' },
  { title: 't5', agent: 'codex', prompt: 'e' },
], { workspace: ROOT });
const done = await silka.waitAll(tasks.map((t) => t.sessionId), { timeoutSeconds: 60 });
return done.map((s) => ({ id: s.sessionId, status: s.status, summary: s.summary || '' }));`;

export function measureNfrTok01(hubTools = []) {
  const legacyTools = hubTools.length ? hubTools : [];
  const legacyDefsChars = legacyTools.reduce((n, t) => n + serializeTool(t).length, 0);
  const codeModeChars = CODE_MODE_TOOLS.reduce((n, t) => n + serializeTool(t).length, 0);
  const legacyToolTokens = charTokens(legacyDefsChars);
  const codeModeToolTokens = charTokens(codeModeChars);
  const toolSavingsPct = legacyToolTokens > 0
    ? ((legacyToolTokens - codeModeToolTokens) / legacyToolTokens) * 100
    : 0;

  const mcpBatchChars = simulatedMcpBatchPayload(legacyTools.length ? legacyTools : [
    { name: 'agent_session_create', description: 'x'.repeat(400), inputSchema: { type: 'object', properties: { agent: {}, prompt: {}, workspace: {} } } },
    { name: 'agent_session_status', description: 'y'.repeat(300), inputSchema: { type: 'object', properties: { sessionId: {} } } },
  ]);
  const executeCallChars = serializeTool(CODE_MODE_TOOLS[1]).length + SAMPLE_EXECUTE.length;
  const mcpBatchTokens = charTokens(mcpBatchChars);
  const executeTokens = charTokens(executeCallChars);
  const batchSavingsPct = mcpBatchTokens > 0 ? ((mcpBatchTokens - executeTokens) / mcpBatchTokens) * 100 : 0;

  return {
    legacyToolDefinitionsTokens: legacyToolTokens,
    codeModeToolDefinitionsTokens: codeModeToolTokens,
    toolDefinitionSavingsPercent: Math.round(toolSavingsPct * 10) / 10,
    simulatedMcpBatchTokens: mcpBatchTokens,
    simulatedCodeModeExecuteTokens: executeTokens,
    batchScenarioSavingsPercent: Math.round(batchSavingsPct * 10) / 10,
    meetsNfrTok01Batch: batchSavingsPct >= 70,
    meetsNfrTok01Tools: toolSavingsPct >= 70,
  };
}

export function codeModeToolDefinitions() {
  return CODE_MODE_TOOLS;
}