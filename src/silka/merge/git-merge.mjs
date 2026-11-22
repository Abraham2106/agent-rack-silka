import { gitRun } from '../tasks/git.mjs';

/** Rama que avanza la cola (no confundir con la rama checked out en el builder). */
export function mergeDestBranch(repoRoot) {
  const main = gitRun(repoRoot, ['rev-parse', '--verify', 'refs/heads/main'], { repoRoot });
  if (main.ok) return 'main';
  const head = headBranchName(repoRoot);
  return head || 'main';
}

/** @deprecated alias */
export function targetBranch(repoRoot) {
  return mergeDestBranch(repoRoot);
}

export function headSymbolicRef(repoRoot) {
  const r = gitRun(repoRoot, ['symbolic-ref', '-q', 'HEAD'], { repoRoot });
  if (!r.ok || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

export function headBranchName(repoRoot) {
  const r = gitRun(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { repoRoot });
  const name = r.stdout.trim();
  if (r.ok && name && name !== 'HEAD') return name;
  return null;
}

export function destCheckedOutInBuilder(repoRoot, dest) {
  return headSymbolicRef(repoRoot) === `refs/heads/${dest}`;
}

export function refSha(repoRoot, ref) {
  const r = gitRun(repoRoot, ['rev-parse', ref], { repoRoot });
  if (!r.ok) throw new Error(r.stderr || `rev-parse ${ref} falló`);
  return r.stdout.trim();
}

export function builderTreeDirty(repoRoot) {
  const st = gitRun(repoRoot, ['status', '--porcelain'], { repoRoot });
  const lines = st.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.some((line) => {
    const rel = line.slice(3).trim().replace(/\\/g, '/');
    return rel && rel !== '.silka' && !rel.startsWith('.silka/');
  });
}

/** FR-MQ-05: solo difiere si la rama destino está checked out y el árbol está sucio. */
export function shouldDeferForDirtyBuilder(repoRoot, dest) {
  return destCheckedOutInBuilder(repoRoot, dest) && builderTreeDirty(repoRoot);
}

/** Tras CAS: `reset --hard` solo si HEAD es la rama destino (árbol ajeno intacto). */
export function syncBuilderToDestAfterCas(repoRoot, dest) {
  if (!destCheckedOutInBuilder(repoRoot, dest)) {
    return { synced: false, reason: 'head_not_dest' };
  }
  const r = gitRun(repoRoot, ['reset', '--hard', dest], { repoRoot });
  return { synced: r.ok, stderr: r.stderr };
}

/** Commit de entrega en la rama de la tarea (cambios sin commit del agente). */
export function ensureDeliveryCommit(worktreePath, taskId, { repoRoot } = {}) {
  const st = gitRun(worktreePath, ['status', '--porcelain'], { repoRoot });
  if (!st.stdout.trim()) return { committed: false };
  gitRun(worktreePath, ['add', '-A'], { repoRoot });
  const r = gitRun(worktreePath, ['commit', '-m', `silka: entrega ${taskId}`], { repoRoot });
  if (!r.ok) {
    return { ok: false, stderr: r.stderr, stdout: r.stdout };
  }
  return { ok: true, committed: true, sha: refSha(worktreePath, 'HEAD') };
}

export function rebaseOntoTarget(worktreePath, targetBranch, { repoRoot } = {}) {
  const r = gitRun(worktreePath, ['rebase', targetBranch], { repoRoot });
  if (r.ok) {
    return { ok: true, stdout: r.stdout, stderr: r.stderr };
  }
  const paths = [];
  const diff = gitRun(worktreePath, ['diff', '--name-only', '--diff-filter=U'], { repoRoot });
  for (const line of diff.stdout.split(/\r?\n/)) {
    const p = line.trim();
    if (p) paths.push(p);
  }
  gitRun(worktreePath, ['rebase', '--abort'], { repoRoot });
  return {
    ok: false,
    kind: paths.length ? 'conflict' : 'rebase',
    paths,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/** Fast-forward con compare-and-swap (SEC-10). */
export function updateRefCas(repoRoot, ref, newSha, oldSha) {
  const r = gitRun(repoRoot, ['update-ref', ref, newSha, oldSha], { repoRoot });
  return { ok: r.ok, stderr: r.stderr, stdout: r.stdout };
}