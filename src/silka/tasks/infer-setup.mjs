import fs from 'node:fs';
import path from 'node:path';

/** Infiere comandos de setup según lockfile (Node). Python: nada salvo declaración explícita. */
export function inferSetupCommands(worktreePath) {
  const root = path.resolve(worktreePath);
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return ['npm ci'];
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return ['pnpm install --frozen-lockfile'];
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return ['yarn install --frozen-lockfile'];
  return [];
}