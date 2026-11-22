import { clip } from '../format.mjs';
import { isSilkaError } from '../codemode/errors.mjs';
import { createReviewService } from '../review/service.mjs';
import { readTaskLogRef } from '../tasks/log-store.mjs';
import { getTask } from '../tasks/store.mjs';
import { readConversation } from '../transcript.mjs';
import { segLine } from './paint.mjs';
import { palette } from './theme.mjs';

export function reviewWorkspace(session, board) {
  if (session?.workspace) return session.workspace;
  if (board?.cwd) return board.cwd;
  return process.cwd();
}

export function loadReviewInbox(workspace) {
  const svc = createReviewService(workspace, { actor: 'human' });
  return { svc, items: svc.inbox() };
}

export function inboxWindow(items, index, visibleRows) {
  const total = items.length;
  const vis = Math.max(1, visibleRows);
  const at = Math.min(Math.max(0, index), Math.max(0, total - 1));
  const start = Math.min(Math.max(0, at - Math.floor(vis / 2)), Math.max(0, total - vis));
  return { start, at, rows: items.slice(start, start + vis) };
}

export function formatInboxRow(item, { selected = false, width = 96 } = {}) {
  const risk = String(item.risk || '?');
  const gates = String(item.gates || '?');
  const stats = item.diffStats ? `+${item.diffStats.added}/-${item.diffStats.removed}` : '';
  const head = `${selected ? '▸' : ' '} ${risk.padEnd(5)} ${gates} v${item.version} ${stats} `;
  const title = clip(item.title || item.id, Math.max(8, width - head.length));
  return head + title;
}

export function inboxListLines(items, index, height) {
  const vis = Math.max(1, height - 4);
  const { start, at, rows } = inboxWindow(items, index, vis);
  const lines = [];
  if (!items.length) {
    lines.push('Bandeja vacía.');
    return { lines, at: 0 };
  }
  for (let i = 0; i < rows.length; i += 1) {
    const sel = start + i === at;
    lines.push(formatInboxRow(rows[i], { selected: sel }));
  }
  if (items.length > vis) lines.push(`  (${at + 1}/${items.length})`);
  return { lines, at };
}

/** Detalle bajo demanda: stat de diff y logs por ref; sin diff completo en la ficha de lista (FR-RV-05). */
export function reviewDetailLines(workspace, item, { logMax = 14, transcriptMax = 5 } = {}) {
  const lines = [];
  lines.push(`${item.id}  ·  ${item.title || ''}`);
  lines.push(`riesgo ${item.risk}  gates ${item.gates}  v${item.version}  ${item.state || ''}`);
  if (item.declared) lines.push(`entrega: ${clip(String(item.declared), 220)}`);
  if (item.files?.length) lines.push(`archivos: ${item.files.slice(0, 10).join(', ')}`);
  if (item.outOfScope?.length) lines.push(`fuera de ámbito: ${item.outOfScope.join(', ')}`);
  const notes = item.agentSaid?.notes;
  if (notes) lines.push(`agente (${item.agentSaid?.from || 'agente'}): ${clip(notes, 240)}`);
  for (const q of (item.agentSaid?.openQuestions || []).slice(0, 4)) {
    lines.push(`? ${clip(q, 120)}`);
  }
  const stats = item.diffStats;
  if (stats) lines.push(`diff (resumen): +${stats.added} -${stats.removed}`);

  if (item.id && !String(item.id).startsWith('wave:')) {
    const task = getTask(workspace, item.id);
    const summary = task?.card?.diff?.summary;
    if (summary) {
      lines.push('git stat:');
      for (const line of String(summary).split('\n').slice(0, 10)) {
        if (line.trim()) lines.push(`  ${clip(line, 110)}`);
      }
    }
  }

  for (const ev of (item.evidence || []).slice(0, 6)) {
    const bit = `${ev.kind}: ${ev.ok ? 'ok' : 'fail'}${ev.cmd ? ` ${ev.cmd}` : ''}`;
    lines.push(`evidencia ${bit}`);
  }

  if (item.verifyRef) {
    try {
      const log = readTaskLogRef(item.verifyRef, workspace);
      lines.push(`log ${item.verifyRef}:`);
      for (const line of log.split('\n').slice(0, logMax)) {
        if (line.trim()) lines.push(`  ${clip(line, 116)}`);
      }
    } catch {
      lines.push(`log: ${item.verifyRef} (no disponible)`);
    }
  }

  if (item.sessionId) {
    try {
      const events = readConversation(item.sessionId, { tasks: [], sessions: [] });
      if (events.length) {
        lines.push('transcript (reciente):');
        for (const ev of events.slice(-transcriptMax)) {
          const text = clip(ev.text || ev.summary || ev.kind || '', 96);
          lines.push(`  ${ev.role || ev.author || ev.kind || '?'}: ${text}`);
        }
      }
    } catch {
      lines.push(`sesión: ${item.sessionId}`);
    }
  }
  return lines;
}

export function reviewBannerFromError(err) {
  if (!isSilkaError(err)) {
    return { text: err instanceof Error ? err.message : String(err), color: 'red', refresh: false };
  }
  if (err.code === 'E_STALE') {
    return { text: 'La ficha cambió; bandeja actualizada.', color: 'yellow', refresh: true, staleCard: err.card };
  }
  return { text: `${err.code}: ${err.message}`, color: 'red', refresh: false };
}

export function reviewBannerFromResult(action, res) {
  if (res?.noop) return { text: `${action}: sin cambios (idempotente).`, color: 'yellow', refresh: false };
  return { text: `${action}: aplicado.`, color: 'green', refresh: true };
}

export function reviewFooterKeys(width) {
  const keys = [
    ['↑↓', 'elige'],
    ['a', 'aprueba'],
    ['x', 'rechaza'],
    ['d', 'descarta'],
    ['enter', 'detalle'],
    ['r', 'refresca'],
    ['esc', 'vuelve'],
  ];
  const segs = [];
  let used = 0;
  for (const [key, label] of keys) {
    const len = key.length + label.length + 4;
    if (used + len > width) break;
    segs.push({ text: key, color: palette.steelDim, bold: true }, { text: ` ${label}   `, color: palette.muted });
    used += len;
  }
  return segs;
}

export function renderReviewInbox(h, Box, Text, { height, columns, items, index }) {
  const { lines } = inboxListLines(items, index, height);
  return h(
    Box,
    { flexGrow: 1, height, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
    h(Text, { bold: true }, 'Bandeja de revisión'),
    ...lines.map((line, i) => h(
      Text,
      {
        key: `rv-${i}`,
        wrap: 'truncate',
        bold: line.startsWith('▸'),
        color: line.startsWith('▸') ? palette.ink : palette.steelDim,
      },
      clip(line, columns - 4),
    )),
  );
}

export function renderReviewDetail(h, Box, Text, { height, columns, lines }) {
  const shown = (lines || []).slice(0, Math.max(1, height - 3));
  return h(
    Box,
    { flexGrow: 1, height, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
    h(Text, { bold: true }, 'Detalle de ficha'),
    ...shown.map((line, index) => h(
      Text,
      { key: `rvd-${index}`, wrap: 'truncate', dimColor: line.startsWith('  ') },
      clip(line, columns - 4),
    )),
  );
}

export function reviewComposerLine(h, Text, mode, width) {
  const hints = {
    review: 'Bandeja · ↑↓ elige · a aprueba · x rechaza con nota · d descarta · enter detalle · r refresca · esc vuelve',
    'review-detail': 'Detalle · enter o esc vuelve a la bandeja',
    'review-reject': 'Nota de rechazo · enter envía a la misma sesión · esc cancela',
  };
  return segLine(h, Text, [{ text: clip(hints[mode] || hints.review, width), color: palette.muted }], 'rv-hint');
}