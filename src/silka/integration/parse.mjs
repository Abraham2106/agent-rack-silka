import fs from 'node:fs';
import path from 'node:path';
import { silkaError } from '../codemode/errors.mjs';
import { inferVerifyCommands } from '../tasks/infer-verify.mjs';
import { normalizeTaskInput } from '../tasks/model.mjs';
import { newTaskId } from '../tasks/store.mjs';
import { newPlanId } from './store.mjs';
import { computeWaves } from './waves.mjs';

function parseVerify(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(/\n|&&/).map((s) => s.trim()).filter(Boolean);
}

function parseIntegration(integration, repoRoot) {
  if (!integration || typeof integration !== 'object') return null;
  let verify = parseVerify(integration.verify);
  let verifySource = verify.length ? 'declarado' : 'pendiente';
  if (!verify.length && repoRoot) {
    const inferred = inferVerifyCommands(repoRoot);
    if (inferred?.length) {
      verify = inferred;
      verifySource = 'inferido';
    }
  }
  const maxRepairs = Number(integration.maxRepairs);
  const setup = integration.setup != null ? integration.setup : { mode: 'link' };
  return {
    verify,
    verifySource,
    accept: integration.accept || [],
    setup,
    maxRepairs: Number.isInteger(maxRepairs) && maxRepairs >= 0 ? maxRepairs : 2,
  };
}

export function parsePlanDocument(raw, { repoRoot, planId } = {}) {
  if (Array.isArray(raw)) {
    const tasks = raw.map((item) => normalizeTaskInput(item, { repoRoot, strictVerify: true }));
    return { tasks, plan: null };
  }
  if (!raw || typeof raw !== 'object') {
    throw silkaError('E_TASK_INVALID', 'El plan debe ser una lista o un objeto con tasks.');
  }
  const list = Array.isArray(raw.tasks) ? raw.tasks : null;
  if (!list?.length) {
    throw silkaError('E_TASK_INVALID', 'El plan debe incluir tasks no vacío.');
  }
  const tasks = list.map((item) => normalizeTaskInput(item, {
    repoRoot,
    strictVerify: true,
    id: item.id || newTaskId(),
  }));
  const waves = computeWaves(tasks, raw.waves);
  const integration = raw.integration ? parseIntegration(raw.integration, repoRoot) : null;
  const id = planId || raw.planId || raw.id || newPlanId();
  for (const task of tasks) {
    for (let w = 0; w < waves.length; w += 1) {
      if (waves[w].includes(task.id)) {
        task.planId = id;
        task.wave = w;
      }
    }
  }
  return {
    tasks,
    plan: integration ? {
      id,
      integration,
      waves,
      wavesState: waves.map((_, index) => ({
        index,
        status: 'pending',
        mergeCommits: [],
        evidence: null,
        culpritTaskId: null,
        waveCard: null,
        blockedReason: null,
      })),
    } : null,
  };
}

export function planDocumentFromFile(filePath, cwd = process.cwd()) {
  const abs = path.resolve(cwd, filePath);
  if (!fs.existsSync(abs)) {
    throw silkaError('E_NOT_FOUND', `No existe el plan: ${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');
  let parsed;
  if (abs.toLowerCase().endsWith('.json')) {
    parsed = JSON.parse(text);
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      const block = text.match(/```json\s*([\s\S]*?)```/i);
      if (!block) throw silkaError('E_TASK_INVALID', 'Formato de plan no reconocido.');
      parsed = JSON.parse(block[1]);
    }
  }
  return parsePlanDocument(parsed, { repoRoot: path.resolve(cwd) });
}