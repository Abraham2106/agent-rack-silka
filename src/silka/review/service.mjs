import { silkaError } from '../codemode/errors.mjs';
import { findGitRoot } from '../tasks/git.mjs';
import { createTaskManager } from '../tasks/manager.mjs';
import { canTransition, STATES } from '../tasks/states.mjs';
import { getTask, mutateTaskStore } from '../tasks/store.mjs';
import { appendReviewAudit } from './audit.mjs';
import { inboxItemFromTask, listInbox } from './inbox.mjs';
import { assertCanApprove } from './policy.mjs';

function nowIso() {
  return new Date().toISOString();
}

function recordTransition(task, to, cause) {
  const from = task.state;
  if (!canTransition(from, to)) {
    throw silkaError('E_POLICY', `Transición inválida: ${from} → ${to}`);
  }
  task.state = to;
  task.version = (Number(task.version) || 0) + 1;
  task.transitions = task.transitions || [];
  task.transitions.push({ at: nowIso(), from, to, cause: cause || '' });
  return task;
}

function staleError(task) {
  const item = inboxItemFromTask(task) || { id: task.id, version: task.version, state: task.state };
  throw silkaError('E_STALE', 'La tarea cambió desde la última vista; actualiza la ficha.', { card: item });
}

function assertVersion(opts) {
  const version = Number(opts?.version);
  if (!Number.isFinite(version) || version < 1) {
    throw silkaError('E_POLICY', 'Cada acción de revisión requiere version (número de versión visto).');
  }
  return version;
}

function lastReviewMatches(task, action, seenVersion) {
  const lr = task.lastReview;
  return lr?.action === action && Number(lr.seenVersion) === Number(seenVersion);
}

function auditDecision(repoRoot, row) {
  appendReviewAudit(repoRoot, row);
}

export function createReviewService(workspace, opts = {}) {
  const repoRoot = findGitRoot(workspace) || workspace;
  const actor = opts.actor === 'manager' ? 'manager' : 'human';
  const mgr = createTaskManager(repoRoot, opts);

  return {
    inbox() {
      return listInbox(repoRoot);
    },

    approve(taskId, options = {}) {
      const seenVersion = assertVersion(options);
      let noop = false;
      let resultTask = null;
      mutateTaskStore(repoRoot, (store) => {
        const task = store.tasks.find((t) => t.id === taskId);
        if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
        if (lastReviewMatches(task, 'approve', seenVersion)) {
          noop = true;
          resultTask = task;
          return store;
        }
        if (Number(task.version) !== seenVersion) {
          staleError(task);
        }
        if (task.state !== STATES.LISTA) {
          throw silkaError('E_POLICY', `Solo se aprueba desde lista para revisión (estado: ${task.state}).`);
        }
        assertCanApprove(task.card, actor, {
          requireHumanForMedium: opts.requireHumanForMedium,
        });
        recordTransition(task, STATES.APROBADA, 'revision_aprobar');
        recordTransition(task, STATES.COLA_MEZCLA, 'cola_mezcla_f4');
        task.lastReview = { action: 'approve', seenVersion, at: nowIso(), actor };
        auditDecision(repoRoot, {
          taskId,
          actor,
          decision: 'approve',
          seenVersion,
          taskVersion: task.version,
        });
        resultTask = task;
        return store;
      });
      return { noop, task: resultTask, state: resultTask?.state };
    },

    async reject(taskId, note, options = {}) {
      const text = String(note ?? '').trim();
      if (!text) throw silkaError('E_POLICY', 'Rechazar requiere una nota no vacía.');
      const seenVersion = assertVersion(options);
      let task = getTask(repoRoot, taskId);
      if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
      if (lastReviewMatches(task, 'reject', seenVersion)) {
        return { noop: true, task };
      }
      if (Number(task.version) !== seenVersion) staleError(task);
      if (task.state !== STATES.LISTA && task.state !== STATES.REPARANDO) {
        throw silkaError('E_POLICY', `No se puede rechazar en estado ${task.state}.`);
      }

      mutateTaskStore(repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === taskId);
        if (!row) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
        if (row.state === STATES.LISTA) recordTransition(row, STATES.RECHAZADA, 'revision_rechazar');
        else recordTransition(row, STATES.TRABAJANDO, 'revision_rechazar');
        row.rejectNote = text;
        row.lastReview = { action: 'reject', seenVersion, at: nowIso(), actor };
        auditDecision(repoRoot, {
          taskId,
          actor,
          decision: 'reject',
          seenVersion,
          taskVersion: row.version,
          note: text,
        });
        task = row;
        return store;
      });

      if (opts.callHub && task.sessionId) {
        await opts.callHub('agent_session_send', { sessionId: task.sessionId, message: text });
      }

      if (task.state === STATES.RECHAZADA) {
        mutateTaskStore(repoRoot, (store) => {
          const row = store.tasks.find((t) => t.id === taskId);
          if (row?.state === STATES.RECHAZADA) recordTransition(row, STATES.TRABAJANDO, 'rechazo_reanuda');
          return store;
        });
        task = getTask(repoRoot, taskId);
      }

      return { noop: false, task };
    },

    discard(taskId, options = {}) {
      const seenVersion = assertVersion(options);
      let task = getTask(repoRoot, taskId);
      if (!task) throw silkaError('E_NOT_FOUND', `Tarea no encontrada: ${taskId}`);
      if (lastReviewMatches(task, 'discard', seenVersion) || task.state === STATES.DESCARTADA) {
        return { noop: true, ...mgr.requestDiscard(taskId) };
      }
      if (Number(task.version) !== seenVersion) staleError(task);
      if (task.state !== STATES.LISTA && task.state !== STATES.REPARANDO) {
        throw silkaError('E_POLICY', `No se puede descartar en estado ${task.state}.`);
      }
      auditDecision(repoRoot, {
        taskId,
        actor,
        decision: 'discard',
        seenVersion,
        taskVersion: task.version,
      });
      mutateTaskStore(repoRoot, (store) => {
        const row = store.tasks.find((t) => t.id === taskId);
        if (row) row.lastReview = { action: 'discard', seenVersion, at: nowIso(), actor };
        return store;
      });
      const res = mgr.requestDiscard(taskId, 'revision_descartar');
      return { noop: false, ...res, task: getTask(repoRoot, taskId) };
    },
  };
}