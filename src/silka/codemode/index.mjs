export { SILKA_API_VERSION } from './version.mjs';
export { searchSignatures } from './search.mjs';
export { executeCodeMode } from './execute.mjs';
export { SandboxRunner, runSandboxSnippet } from './runner.mjs';
export { getStoredRef, storeExecutionResult, resetOutputStore } from './output-store.mjs';
export { measureNfrTok01, codeModeToolDefinitions } from './token-metrics.mjs';
export { silkaError, formatRuntimeError, isSilkaError } from './errors.mjs';

export const CODE_MODE_TOOLS = [
  {
    name: 'silka_search',
    description:
      'Descubrimiento progresivo de la API Silka: devuelve firmas TypeScript y JSDoc relevantes (máx. 4 KB) más la versión semver del contrato.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Palabras clave, por ejemplo "launch waitAll state".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'silka_execute',
    description:
      'Ejecuta un programa JavaScript corto con el objeto `silka` en un sandbox Node (--permission). Devuelve el valor de retorno serializado o una referencia out:<id> si supera 8 KB.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Cuerpo async: usa `silka` como en silka.d.ts.' },
        workspace: { type: 'string', description: 'Workspace canónico para llamadas a la API.' },
        timeoutSeconds: {
          type: 'number',
          description: 'Tiempo de pared máximo (default 60 s, máximo 3600 s para esperas por IPC).',
        },
      },
      required: ['code', 'workspace'],
    },
  },
];