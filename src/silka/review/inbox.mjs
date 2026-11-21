import { STATES } from '../tasks/states.mjs';
import { readTaskStore } from '../tasks/store.mjs';
import { escapeAgentText } from './escape.mjs';

const RISK_ORDER = { alto: 0, medio: 1, bajo: 2 };

const INBOX_STATES = new Set([STATES.LISTA, STATES.VERIFICACION_FALLIDA]);

function enteredAt(task) {
  const transitions = task.transitions || [];
  for (let i = transitions.length - 1; i >= 0; i -= 1) {
    const t = transitions[i];
    if (t.to === STATES.LISTA || t.to === STATES.VERIFICACION_FALLIDA || t.to === STATES.REPARANDO) {
      return t.at || task.createdAt;
    }
  }
  return task.createdAt || '';
}

/** Ficha de bandeja: sin diff completo (FR-RV-05). */
export function inboxItemFromTask(task) {
  if (!task?.card) return null;
  const mergeRepair = task.state === STATES.REPARANDO && task.mergeFailure;
  if (!INBOX_STATES.has(task.state) && !mergeRepair) return null;
  const card = task.card;
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    version: task.version,
    risk: card.risk,
    gates: card.gates,
    declared: card.declared,
    agentSaid: {
      notes: escapeAgentText(card.agentSays ?? card.agentNotes),
      from: card.agentSaysFrom || 'agente',
      openQuestions: (card.openQuestions || []).map(escapeAgentText),
    },
    evidence: card.evidence || [],
    verifySource: card.verifySource,
    files: card.files || [],
    outOfScope: card.outOfScope || [],
    diffStats: {
      added: card.diff?.added ?? 0,
      removed: card.diff?.removed ?? 0,
    },
    verifyRef: card.verify?.ref,
    enteredAt: enteredAt(task),
    sessionId: task.sessionId || null,
  };
}

export function listInbox(repoRoot) {
  const store = readTaskStore(repoRoot);
  const items = store.tasks
    .map(inboxItemFromTask)
    .filter(Boolean)
    .sort((a, b) => {
      const ra = RISK_ORDER[a.risk] ?? 9;
      const rb = RISK_ORDER[b.risk] ?? 9;
      if (ra !== rb) return ra - rb;
      const ta = Date.parse(a.enteredAt) || 0;
      const tb = Date.parse(b.enteredAt) || 0;
      return ta - tb;
    });
  return items;
}