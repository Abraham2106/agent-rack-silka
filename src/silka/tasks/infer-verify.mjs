import fs from 'node:fs';
import path from 'node:path';

function packageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function runScript(pm, script) {
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'pnpm') return `pnpm run ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}

/** Infiere verify del worktree (test, lint, typecheck, pytest, cargo, go). */
export function inferVerifyCommands(worktreePath) {
  const root = path.resolve(worktreePath);
  const pkg = path.join(root, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {};
      const pm = packageManager(root);
      const cmds = [];
      for (const key of ['test', 'lint', 'typecheck']) {
        if (scripts[key]) cmds.push(runScript(pm, key));
      }
      if (cmds.length) return cmds;
    } catch { /* sigue */ }
  }
  if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'pytest.ini'))) {
    return ['python -m pytest'];
  }
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
    return ['cargo test'];
  }
  if (fs.existsSync(path.join(root, 'go.mod'))) {
    return ['go test ./...'];
  }
  return null;
}