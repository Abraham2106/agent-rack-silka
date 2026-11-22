import path from 'node:path';
import { silkaDir } from '../state.mjs';

export function contextDir(workspace) {
  return path.join(silkaDir(workspace), 'context');
}

export function packagePath(workspace, sha) {
  return path.join(contextDir(workspace), `${String(sha).slice(0, 40)}.md`);
}

export function contextRefsDir(workspace) {
  return path.join(contextDir(workspace), 'refs');
}