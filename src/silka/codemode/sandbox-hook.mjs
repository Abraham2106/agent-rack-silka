// Lista de módulos denegados en el sandbox de Code Mode (SEC-02, ADR-0004).
// El permission model de Node 22 no restringe la red: se bloquean los módulos que la abren,
// los que ejecutan procesos o código (child_process, worker_threads, cluster, vm, inspector)
// y 'module' (que permitiría registrar hooks propios y saltarse esta lista).
export const DENIED = new Set([
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'child_process',
  'worker_threads',
  'cluster',
  'vm',
  'inspector',
  'module',
]);

export function bareName(specifier) {
  const raw = String(specifier).replace(/^node:/, '');
  return raw.split('/')[0];
}

export function deniedError(base) {
  const err = new Error(`E_POLICY: módulo '${base}' no permitido en Code Mode`);
  err.code = 'E_POLICY';
  return err;
}
