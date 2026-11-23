// review-guardrails (RG-01..RG-06): revisión automática acotada, de solo lectura y sin bloquear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReviewPrompt,
  finishReview,
  loadAutoReviewConfig,
  parseReviewFindings,
  pickReviewerAgent,
  resolveReviewerRouting,
  riskAfterReview,
  runAutoReviews,
  startReview,
  worktreeSnapshot,
  REVIEW_STATUS,
} from '../src/silka/review/auto.mjs';
import { reviewSummary, inboxItemFromTask } from '../src/silka/review/inbox.mjs';
import { assessRisk } from '../src/silka/tasks/risk.mjs';
import { STATES } from '../src/silka/tasks/states.mjs';
import { mutateTaskStore, readTaskStore } from '../src/silka/tasks/store.mjs';
import { buildDeliveryCard } from '../src/silka/tasks/card.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-rg-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@example.invalid']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, base };
}

const task = (over = {}) => ({
  id: 't-1',
  title: 'Cambio de prueba',
  deliver: 'Tocar a.txt',
  scope: ['a.txt'],
  accept: [],
  state: STATES.LISTA,
  routing: { agent: 'codex' },
  ...over,
});

test('RG-01: el encargo del revisor lleva solo la spec y el diff, sin transcript del implementador', () => {
  const prompt = buildReviewPrompt({
    task: task(),
    diffText: '+linea nueva',
    workspace: os.tmpdir(),
  });
  assert.match(prompt, /## Spec de la tarea/);
  assert.match(prompt, /Tocar a\.txt/);
  assert.match(prompt, /\+linea nueva/);
  assert.doesNotMatch(prompt, /transcript|conversación del implementador/i);
});

test('RG-01: la configuración se activa solo con enabled true', () => {
  const repo = tmpRepo().dir;
  assert.equal(loadAutoReviewConfig(repo).enabled, false);
  fs.mkdirSync(path.join(repo, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.silka', 'review.json'), JSON.stringify({ enabled: true, timeoutMinutes: 2 }));
  const cfg = loadAutoReviewConfig(repo);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.timeoutMs, 120_000);
});

test('RG-02: el revisor es de otro agente que el implementador', () => {
  assert.equal(pickReviewerAgent('codex'), 'cursor');
  assert.equal(pickReviewerAgent('cursor', ['cursor', 'opencode']), 'opencode');
  assert.equal(pickReviewerAgent('codex', ['codex']), null);
});

test('RG-02: con tabla de routing para revisar, el modelo sale de esa regla; si el agente coincide con el implementador, se elige otro', () => {
  const repo = tmpRepo().dir;
  fs.mkdirSync(path.join(repo, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.silka', 'routing.json'), JSON.stringify({
    rules: { revisar: { media: { agent: 'codex', models: ['gpt-rev'] } } },
  }));
  const r = resolveReviewerRouting(task({ routing: { agent: 'codex' } }), { repoRoot: repo, candidates: ['codex', 'cursor'] });
  assert.equal(r.agent, 'cursor');
  assert.equal(r.model, undefined);
  const same = resolveReviewerRouting(task({ routing: { agent: 'cursor' } }), { repoRoot: repo, candidates: ['codex', 'cursor'] });
  assert.equal(same.agent, 'codex');
  assert.equal(same.model, 'gpt-rev');
});

test('RG-03: un revisor que escribe en el worktree deja la revisión fallida y sus hallazgos descartados', async () => {
  const { dir, base } = tmpRepo();
  const t = task({ worktreePath: dir, baseCommit: base });
  let logs = null;
  const callHub = async (name, args) => {
    if (name === 'agent_session_create') {
      assert.equal(args.mode, 'read-only');
      assert.notEqual(args.agent, 'codex');
      // El revisor falso escribe un archivo: debe detectarse.
      fs.writeFileSync(path.join(dir, 'intruso.txt'), 'x');
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId: 's-rev' }) }] };
    }
    if (name === 'agent_session_logs') {
      logs = { events: [{ metadata: { type: 'result' }, content: JSON.stringify({ findings: [{ severity: 'grave', file: 'a.txt', motivo: 'x' }] }) }] };
      return { content: [{ type: 'text', text: JSON.stringify(logs) }] };
    }
    throw new Error(`inesperado ${name}`);
  };
  const started = await startReview({ repoRoot: dir, task: t, callHub, candidates: ['cursor'], diffText: '' });
  assert.equal(started.status, REVIEW_STATUS.PENDIENTE);
  const done = await finishReview({
    task: t,
    card: {},
    review: started,
    callHub,
    session: { status: 'completed' },
    busy: false,
  });
  assert.equal(done.status, REVIEW_STATUS.FALLIDA);
  assert.equal(done.worktreeAlterado, true);
  assert.deepEqual(done.findings, []);
});

test('RG-03: un revisor que no escribe deja la revisión hecha', async () => {
  const { dir, base } = tmpRepo();
  const t = task({ worktreePath: dir, baseCommit: base });
  const callHub = async (name) => {
    if (name === 'agent_session_create') return { content: [{ type: 'text', text: JSON.stringify({ sessionId: 's-ok' }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ events: [{ metadata: { type: 'result' }, content: '{"findings":[]}' }] }) }] };
  };
  const started = await startReview({ repoRoot: dir, task: t, callHub, candidates: ['cursor'], diffText: '' });
  const done = await finishReview({ task: t, card: {}, review: started, callHub, session: { status: 'completed' }, busy: false });
  assert.equal(done.status, REVIEW_STATUS.HECHA);
  assert.equal(worktreeSnapshot(dir), started.snapshot);
});

test('RG-04: hallazgos con severidad, archivo y motivo; texto de agente escapado y datos inválidos descartados', () => {
  const text = JSON.stringify({
    findings: [
      { severity: 'media', file: 'src/a.mjs', motivo: 'falta validar \u001b[31mrojo\u001b[0m' },
      { severity: 'grave', file: 'src/b.mjs', motivo: 'ignora errores' },
      { severity: 'critica', file: 'x', motivo: 'severidad no válida' },
    ],
  });
  const parsed = parseReviewFindings(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.dropped, 1);
  assert.equal(parsed.findings[0].severity, 'media');
  assert.equal(parsed.findings[0].file, 'src/a.mjs');
  assert.equal(parsed.findings[0].motivo, 'falta validar rojo');
  assert.equal(parseReviewFindings('no es json').ok, false);
});

test('RG-05: un hallazgo grave sube una ficha de riesgo bajo a alto con causa revision_automatica', () => {
  const low = assessRisk({ verifyOk: true, files: ['src/a.mjs'], outOfScope: [], diffLines: 10 });
  assert.equal(low.level, 'bajo');
  const high = assessRisk({
    verifyOk: true,
    files: ['src/a.mjs'],
    outOfScope: [],
    diffLines: 10,
    reviewFindings: [{ severity: 'grave', file: 'src/a.mjs', motivo: 'x' }],
  });
  assert.equal(high.level, 'alto');
  assert.ok(high.reasons.includes('revision_automatica'));
  assert.equal(high.requiresHuman, true);
  const medium = assessRisk({ verifyOk: true, files: ['src/a.mjs'], outOfScope: [], diffLines: 10, reviewFindings: [{ severity: 'media', file: 'a', motivo: 'b' }] });
  assert.equal(medium.level, 'bajo');
});

test('RG-05: riskAfterReview reevalúa la ficha con los hallazgos', () => {
  const card = { verify: { ok: true }, filesAll: ['src/a.mjs'], outOfScope: [], diff: { added: 5, removed: 1 } };
  const r = riskAfterReview({ id: 't' }, card, [{ severity: 'grave', file: 'src/a.mjs', motivo: 'x' }]);
  assert.equal(r.level, 'alto');
});

test('RG-06: la bandeja muestra "sin revisión automática" cuando la revisión falla, y sin hallazgos', () => {
  const failed = reviewSummary({ status: 'fallida', reason: 'el revisor agotó su tiempo', findings: [] });
  assert.equal(failed.sinRevision, true);
  assert.deepEqual(failed.findings, []);
  const done = reviewSummary({ status: 'hecha', findings: [{ severity: 'media', file: 'a', motivo: 'b' }] });
  assert.equal(done.sinRevision, false);
  assert.equal(done.findings.length, 1);
  assert.equal(reviewSummary(null), null);
});

test('RG-06: la ficha llega a la bandeja aunque el revisor falle; el ciclo no lanza', async () => {
  const { dir, base } = tmpRepo();
  fs.mkdirSync(path.join(dir, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.silka', 'review.json'), JSON.stringify({ enabled: true, candidates: ['cursor'] }));
  const card = buildDeliveryCard(task({ worktreePath: dir, baseCommit: base }), {
    diff: { files: ['a.txt'], added: 1, removed: 0 },
    evidence: [{ kind: 'verify', ok: true }],
  });
  mutateTaskStore(dir, (store) => {
    store.tasks.push({
      id: 't-1',
      title: 'Cambio de prueba',
      state: STATES.LISTA,
      version: 1,
      worktreePath: dir,
      baseCommit: base,
      transitions: [],
      card,
    });
    return store;
  });
  const callHub = async (name) => {
    if (name === 'agent_session_create') throw new Error('hub caído');
    throw new Error('no debería llamarse');
  };
  const n = await runAutoReviews({ repoRoot: dir, callHub, log: () => {} });
  assert.equal(n, 1);
  const row = readTaskStore(dir).tasks.find((t) => t.id === 't-1');
  assert.equal(row.card.review.status, REVIEW_STATUS.FALLIDA);
  const item = inboxItemFromTask(row);
  assert.ok(item, 'la ficha sigue en la bandeja');
  assert.equal(item.review.sinRevision, true);
  assert.deepEqual(item.review.findings, []);
});

test('RG-01 + RG-02: prompt con skills de revisor y verificador cuando existen', () => {
  const { dir } = tmpRepo();
  fs.mkdirSync(path.join(dir, '.silka', 'skills', 'revisor'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.silka', 'skills', 'verificador'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.silka', 'skills', 'revisor', 'r.md'), '---\nrol: revisor\nalcance: *\n---\nREGLA-REVISOR\n');
  fs.writeFileSync(path.join(dir, '.silka', 'skills', 'verificador', 'v.md'), '---\nrol: verificador\nalcance: *\n---\nREGLA-VERIFICADOR\n');
  const prompt = buildReviewPrompt({ task: task(), diffText: '', workspace: dir });
  assert.match(prompt, /REGLA-REVISOR/);
  assert.match(prompt, /REGLA-VERIFICADOR/);
});

test('RG-04 + RG-06: la bandeja muestra severidad, archivo y el aviso sin revisión automática', async () => {
  const { formatInboxRow, reviewDetailLines } = await import('../src/silka/ui/review.mjs');
  const { dir } = tmpRepo();
  const hecha = {
    id: 'h', title: 'Con hallazgos', risk: 'alto', gates: 'pass', version: 2,
    review: reviewSummary({ status: 'hecha', reviewer: 'cursor', findings: [{ severity: 'grave', file: 'src/b.mjs', motivo: 'ignora errores' }] }),
  };
  const sin = {
    id: 's', title: 'Sin revisión', risk: 'bajo', gates: 'pass', version: 1,
    review: reviewSummary({ status: 'fallida', reason: 'el revisor agotó su tiempo', findings: [] }),
  };
  assert.match(formatInboxRow(hecha), /rv:1!/);
  assert.match(formatInboxRow(sin), /rv:—/);
  const lines = reviewDetailLines(dir, hecha).join('\n');
  assert.match(lines, /\[grave\] src\/b\.mjs — ignora errores/);
  const linesSin = reviewDetailLines(dir, sin).join('\n');
  assert.match(linesSin, /sin revisión automática/);
});
