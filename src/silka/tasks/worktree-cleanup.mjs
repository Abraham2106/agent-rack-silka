import fs from 'node:fs';
import path from 'node:path';

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** Compara lockfiles Node entre dos raíces. */
export function nodeLockfilesMatch(repoRoot, worktreePath) {
  const a = path.resolve(repoRoot);
  const b = path.resolve(worktreePath);
  for (const name of LOCKFILES) {
    const pa = path.join(a, name);
    const pb = path.join(b, name);
    if (fs.existsSync(pa) || fs.existsSync(pb)) {
      if (!fs.existsSync(pa) || !fs.existsSync(pb)) return false;
      const norm = (p) => fs.readFileSync(p).toString('utf8').replace(/\r\n/g, '\n');
      return norm(pa) === norm(pb);
    }
  }
  return false;
}

/** node_modules es enlace o junction (no un directorio material). */
export function isNodeModulesLink(nmPath) {
  if (!fs.existsSync(nmPath)) return false;
  const st = fs.lstatSync(nmPath);
  if (st.isSymbolicLink()) return true;
  if (process.platform === 'win32') {
    try {
      const target = fs.readlinkSync(nmPath);
      return Boolean(target);
    } catch {
      return false;
    }
  }
  return false;
}

/** Quita solo el enlace; nunca borra el árbol del destino. */
export function removeLinkedNodeModules(worktreePath) {
  const nm = path.join(path.resolve(worktreePath), 'node_modules');
  if (!isNodeModulesLink(nm)) return { removed: false };
  try {
    const st = fs.lstatSync(nm);
    if (st.isSymbolicLink() && st.isFile()) {
      fs.unlinkSync(nm);
    } else {
      fs.rmdirSync(nm);
    }
    return { removed: true, path: nm };
  } catch (err) {
    return { removed: false, error: String(err) };
  }
}

/** Antes de git worktree remove / rmSync del worktree: desengancha node_modules enlazado. */
export function prepareWorktreeRemoval(repoRoot, worktreePath) {
  const wt = path.resolve(worktreePath);
  const mainNm = path.join(path.resolve(repoRoot), 'node_modules');
  const unlink = removeLinkedNodeModules(wt);
  const mainOk = !fs.existsSync(mainNm) || fs.existsSync(mainNm);
  return { ...unlink, mainNodeModulesIntact: mainOk };
}