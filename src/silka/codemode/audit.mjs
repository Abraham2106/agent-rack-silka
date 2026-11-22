import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../redact.mjs';

function auditPath(workspace) {
  return path.join(workspace, '.silka', 'codemode-audit.jsonl');
}

export function appendCodeModeAudit(workspace, record) {
  const dir = path.join(workspace, '.silka');
  fs.mkdirSync(dir, { recursive: true });
  const row = {
    at: new Date().toISOString(),
    apiCalls: record.apiCalls,
    ...record,
    code: record.codeContainsSecrets ? '[redactado]' : record.code,
  };
  delete row.codeContainsSecrets;
  fs.appendFileSync(auditPath(workspace), `${JSON.stringify(row)}\n`, 'utf8');
}

export function codeLooksSecret(code) {
  const text = String(code ?? '');
  return /\bsk-[A-Za-z0-9_\-]{8,}/.test(text)
    || /\b(token|api[_-]?key|secret|password)\s*[:=]/i.test(text)
    || /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\./.test(text);
}

export function redactForAudit(code) {
  return redactSecrets(code);
}