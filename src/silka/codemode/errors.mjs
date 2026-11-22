export function silkaError(code, message, extra = {}) {
  return { code, message, ...extra };
}

export function isSilkaError(value) {
  return Boolean(value && typeof value === 'object' && typeof value.code === 'string');
}

export function formatRuntimeError(err, { lineOffset = 1 } = {}) {
  if (isSilkaError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  let line;
  const stack = err instanceof Error ? err.stack : '';
  const m = /evalmachine\.<anonymous>:(\d+)|<anonymous>:(\d+)/.exec(stack || '');
  if (m) line = Number(m[1] || m[2]) - lineOffset;
  if (/Unexpected token|Invalid or unexpected token|SyntaxError/.test(message)) {
    return silkaError('E_SYNTAX', message, line != null ? { line } : {});
  }
  if (err?.code === 'ERR_ACCESS_DENIED') {
    return silkaError('E_POLICY', message);
  }
  if (/no permitido en Code Mode/.test(message)) {
    return silkaError('E_POLICY', message);
  }
  return silkaError('E_RUNTIME', message, line != null ? { line } : {});
}