// Se carga con --import antes del código del sandbox.
// Usa module.registerHooks (síncrono, en el MISMO hilo). module.register corre los hooks en un
// worker thread, y el permission model sin --allow-worker lo bloquea (ERR_ACCESS_DENIED
// 'WorkerThreads'); habilitar workers abriría esa vía al código del modelo.
import { registerHooks } from 'node:module';
import { DENIED, deniedError, bareName } from './sandbox-hook.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (DENIED.has(bareName(specifier))) throw deniedError(bareName(specifier));
    return nextResolve(specifier, context);
  },
});
