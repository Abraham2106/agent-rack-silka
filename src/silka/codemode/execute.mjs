import { appendCodeModeAudit, codeLooksSecret } from './audit.mjs';
import { createApiDispatcher } from './api-dispatch.mjs';
import { isSilkaError } from './errors.mjs';
import { storeExecutionResult } from './output-store.mjs';
import { SandboxRunner } from './runner.mjs';
import { SILKA_API_VERSION } from './version.mjs';

/**
 * @param {{ code: string, workspace: string, timeoutSeconds?: number, author: string, ctx: object }} params
 */
export async function executeCodeMode({ code, workspace, timeoutSeconds, author, ctx }) {
  const started = Date.now();
  let apiCalls = 0;
  const dispatch = createApiDispatcher({
    workspace,
    callHub: ctx.callHub,
    callBridgeTool: ctx.callBridgeTool,
    listSessions: ctx.listSessions,
    ownTaskId: ctx.ownTaskId || '',
  });

  const runner = new SandboxRunner({
    timeoutSeconds,
    onApiCall: async (path, args) => {
      apiCalls += 1;
      return dispatch(path, args);
    },
  });

  let raw;
  let ok = true;
  try {
    raw = await runner.run(code);
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    const payload = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      author,
      durationMs: Date.now() - started,
      apiCalls,
      bytesReturned: Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8'),
      apiVersion: SILKA_API_VERSION,
      code,
      codeContainsSecrets: codeLooksSecret(code),
      ok,
    };
    try {
      appendCodeModeAudit(workspace, payload);
    } catch {
      /* auditoría best-effort */
    }
  }

  return {
    apiVersion: SILKA_API_VERSION,
    value: storeExecutionResult(raw),
    apiCalls,
    durationMs: Date.now() - started,
  };
}