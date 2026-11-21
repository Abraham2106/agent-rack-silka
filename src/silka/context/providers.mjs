import { graphHint } from '../graph.mjs';

/**
 * @typedef {object} ContextProvider
 * @property {string} id
 * @property {(workspace: string) => string | null} extra
 */

export function noopContextProvider() {
  return { id: 'none', extra() { return null; } };
}

export function graphifyContextProvider() {
  return {
    id: 'graphify',
    extra(workspace) {
      const hint = graphHint(workspace);
      return hint ? `## Grafo (Graphify)\n${hint}` : null;
    },
  };
}

export function resolveContextProviders(enabled = []) {
  const ids = new Set((enabled || []).map(String));
  const list = [];
  if (ids.has('graphify')) list.push(graphifyContextProvider());
  return list;
}