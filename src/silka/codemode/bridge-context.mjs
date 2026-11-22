import { silkaError } from './errors.mjs';

export function createHubCaller(hub) {
  return async (name, args) => {
    try {
      return await hub.callTool({ name, arguments: args || {} }, undefined, { timeout: 20_000 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw silkaError(
        'E_HUB',
        `${message}. Levanta el hub con \`silka hub\` o \`npm run silka -- hub\` si no está en el puerto configurado.`,
      );
    }
  };
}

export function createBridgeToolCaller({ localTool, textResult, from, sessions }) {
  return async (name, args) => {
    const local = localTool(name, args, from, sessions);
    if (local) {
      if (local.isError) throw silkaError('E_POLICY', local.content?.[0]?.text || 'Error en herramienta local.');
      return local.content?.[0]?.text ?? '';
    }
    throw silkaError('E_NOT_IMPLEMENTED', `Herramienta local no disponible: ${name}`);
  };
}