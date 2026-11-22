import fs from 'node:fs';
import path from 'node:path';
import { appendNote } from './notes.mjs';
import { silkaDataDir } from './paths.mjs';

// Contención de agentes (SEC-15..17): cada intento bloqueado queda auditado y avisa al manager.

const TASK_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function auditFile() {
  return path.join(silkaDataDir(), 'containment.jsonl');
}

/**
 * Id de la tarea de un agente: lo fija el shim (SILKA_TASK_ID) a partir de su carpeta de
 * trabajo, que es `<silka>/wt/<repo>-<hash>/<id>` (ver worktreesBase). Vacío = no es una tarea.
 */
export function taskIdFromWorktree(cwd) {
  if (!cwd) return '';
  const id = path.basename(path.resolve(String(cwd)));
  const repoDir = path.dirname(path.resolve(String(cwd)));
  const wtRoot = path.join(silkaDataDir(), 'wt');
  if (path.dirname(repoDir) !== wtRoot) return '';
  return TASK_ID_RE.test(id) ? id : '';
}

export function callerTaskId(env = process.env) {
  const id = String(env.SILKA_TASK_ID ?? '').trim();
  return TASK_ID_RE.test(id) ? id : '';
}

/** Registra un intento bloqueado y avisa al manager con una nota ligada a la tarea. */
export function auditBlocked({ taskId = '', action, rule, message, now = new Date() }) {
  const row = {
    at: now.toISOString(),
    taskId: taskId || '',
    action: String(action || ''),
    rule: String(rule || ''),
    message: String(message || ''),
  };
  try {
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true });
    fs.appendFileSync(auditFile(), `${JSON.stringify(row)}\n`);
  } catch { /* la auditoría no debe tumbar la respuesta */ }
  try {
    appendNote({
      sessionId: `task:${taskId || 'sin-tarea'}`,
      text: `[contención ${row.rule}] ${row.action}: ${row.message}`,
      kind: 'contencion',
    });
  } catch { /* el aviso es mejor esfuerzo */ }
  return row;
}

/**
 * Guarda para el código de Code Mode dentro de una tarea: una tarea solo toca su propio id.
 * Devuelve null si la llamada es válida; si no, el motivo (el llamador lo lanza como E_POLICY).
 */
export function taskScopeViolation(method, args, ownTaskId) {
  if (!ownTaskId) return null;
  const pick = (value) => String(value ?? '');
  if (method === 'card' || method.startsWith('review.') || method.startsWith('workspace.')) {
    const target = pick(args?.[0]);
    if (target && target !== ownTaskId) return `la tarea ${ownTaskId} no puede usar ${method} sobre ${target}`;
    return null;
  }
  if (method === 'get') {
    const ref = pick(args?.[0]);
    // log:<tarea>#etiqueta nombra su tarea: solo los de la propia. Los ctx:<id> son opacos y no
    // dicen de qué tarea son, así que una tarea no los lee.
    if (ref.startsWith('log:') && !ref.startsWith(`log:${ownTaskId}#`)) {
      return `la tarea ${ownTaskId} no puede leer un log de otra tarea`;
    }
    if (ref.startsWith('ctx:')) return `la tarea ${ownTaskId} no puede leer contextos (ctx:)`;
  }
  return null;
}
