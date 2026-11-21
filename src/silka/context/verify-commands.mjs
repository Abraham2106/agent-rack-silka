import fs from 'node:fs';
import path from 'node:path';

/** Comandos de verificación declarados en package.json y scripts de test. */
export function verifyCommands(workspace) {
  const root = path.resolve(workspace);
  const pkg = path.join(root, 'package.json');
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {};
  } catch {
    return 'sin package.json';
  }
  const lines = [];
  for (const key of ['test', 'smoke', 'lint', 'check']) {
    if (scripts[key]) lines.push(`${key}: npm run ${key}`);
  }
  if (!lines.length && scripts.test) lines.push(`test: npm test`);
  return lines.length ? lines.join('\n') : 'npm test';
}