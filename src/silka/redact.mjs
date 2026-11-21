/** Misma redacción que los logs: tokens, claves y JWT no quedan en el historial. */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/nonce=[a-f0-9]{16,}/g, 'nonce=[redactado]')
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, '[redactado]')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redactado]')
    .replace(/\b(token|api[_-]?key|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[redactado]')
    .replace(/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}/g, '[redactado]');
}
