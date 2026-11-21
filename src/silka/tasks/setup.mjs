import fs from 'node:fs';
import path from 'node:path';
import { writeTaskLog } from './log-store.mjs';
import { inferSetupCommands } from './infer-setup.mjs';
import { nodeLockfilesMatch } from './worktree-cleanup.mjs';
import { spawnShellCommand } from './verify.mjs';

function parseSetupCommands(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(/\n|&&/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @returns {{ mode: 'link'|'install', commands: string[], source: 'declarado'|'inferido'|'ninguno' }}
 */
export function resolveSetupSpec(declared, { repoRoot, worktreePath, defaultMode = 'install' } = {}) {
  let mode = defaultMode === 'link' ? 'link' : 'install';
  let commands = [];
  let source = 'ninguno';

  if (typeof declared === 'string' || Array.isArray(declared)) {
    commands = parseSetupCommands(declared);
    source = commands.length ? 'declarado' : 'ninguno';
  } else if (declared && typeof declared === 'object') {
    if (declared.mode === 'link' || declared.mode === 'install') mode = declared.mode;
    const raw = declared.commands ?? declared.setup;
    commands = parseSetupCommands(raw);
    if (commands.length) source = 'declarado';
  }

  const cwd = worktreePath ? path.resolve(worktreePath) : null;
  if (!commands.length && cwd) {
    const inferred = inferSetupCommands(cwd);
    if (inferred.length) {
      commands = inferred;
      source = 'inferido';
    }
  }

  return { mode, commands, source };
}

export function tryLinkNodeModules(repoRoot, worktreePath) {
  const main = path.resolve(repoRoot);
  const wt = path.resolve(worktreePath);
  const src = path.resolve(main, 'node_modules');
  const dst = path.resolve(wt, 'node_modules');
  if (!fs.existsSync(src)) return { ok: false, reason: 'sin_node_modules_principal' };
  if (!nodeLockfilesMatch(main, wt)) return { ok: false, reason: 'lockfile_distinto' };
  if (fs.existsSync(dst)) {
    return { ok: true, linked: false, already: true };
  }
  try {
    fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
    return { ok: true, linked: true };
  } catch (err) {
    return { ok: false, reason: 'symlink_falló', detail: String(err) };
  }
}

export function runSetupWithEvidence(repoRoot, logId, cwd, setupSpec, {
  timeoutMs = 120_000,
  env = {},
  repoRootForLink,
} = {}) {
  const mainRoot = repoRootForLink || repoRoot;
  const resolved = typeof setupSpec?.mode === 'string'
    ? setupSpec
    : resolveSetupSpec(setupSpec, { repoRoot: mainRoot, worktreePath: cwd });
  const items = [];

  if (resolved.mode === 'link') {
    const link = tryLinkNodeModules(mainRoot, cwd);
    if (link.ok && (link.linked || link.already)) {
      const detail = link.linked ? 'link:node_modules' : 'link:node_modules (ya existía)';
      items.push({
        kind: 'setup',
        ok: true,
        cmd: detail,
        exitCode: 0,
        durationMs: 0,
        ref: null,
      });
      if (!resolved.commands.length || link.linked || link.already) {
        return { ok: true, items, setupRef: null, source: resolved.source };
      }
    }
  }

  if (!resolved.commands.length) {
    return { ok: true, items, skipped: true, source: resolved.source };
  }

  const blocks = [];
  let allOk = true;
  let idx = 0;
  for (const cmd of resolved.commands) {
    const started = Date.now();
    const r = spawnShellCommand(cwd, cmd, { timeoutMs, env });
    const durationMs = Date.now() - started;
    const block = [
      `$ ${cmd}`,
      `exit: ${r.status ?? '?'}`,
      String(r.stdout || ''),
      String(r.stderr || ''),
    ].join('\n');
    blocks.push(block);
    const ref = writeTaskLog(repoRoot, logId, `setup-${idx}`, block);
    const itemOk = r.status === 0;
    items.push({
      kind: 'setup',
      cmd,
      exitCode: r.status ?? null,
      durationMs,
      ok: itemOk,
      ref,
    });
    if (!itemOk) {
      allOk = false;
      break;
    }
    idx += 1;
  }
  const combined = blocks.join('\n---\n');
  const setupRef = writeTaskLog(repoRoot, logId, 'setup', combined);
  return { ok: allOk, items, setupRef, source: resolved.source, log: combined };
}

/** setup de tarea: default install; integración puede pasar defaultMode link vía plan. */
export function setupForTask(task, repoRoot) {
  return resolveSetupSpec(task.setup, {
    repoRoot,
    worktreePath: task.worktreePath,
    defaultMode: task.setupMode || 'install',
  });
}

export function setupForIntegration(integration, repoRoot, worktreePath) {
  const declared = integration?.setup ?? { mode: 'link' };
  return resolveSetupSpec(declared, {
    repoRoot,
    worktreePath,
    defaultMode: 'link',
  });
}