// Prueba de punta a punta del CICLO DE TAREAS con agent-rack REAL (no un hub falso): arranca
// agent-rack en un puerto aparte con la config efectiva del hub, crea un repo desechable, lanza
// tareas con el TaskManager y corre el supervisor de tareas del hub contra ese agent-rack. Los
// agentes son reales (por defecto OpenCode con un modelo gratis) y trabajan en worktrees de la
// carpeta de Silka. Comprueba la ficha que sale de cada escenario.
//   node scripts/e2e-task-cycle.mjs [--port 18997] [--agent opencode] [--model opencode/hy4-flash-free]
//                                   [--escenarios entrega,vacio,caida,lento,codex,cursor,choque-a,choque-b]
//                                   [--verify-s 25] [--max-sesiones N] [--modelo-cursor auto] [--agente-choque codex] [--sin-mezcla]
// Escenarios:
//   entrega  el agente crea un archivo → ficha pass, con evidencia session + diff + verify.
//   vacio    el agente no cambia nada (maxRepairs 0) → ficha fail por diff y el verify no se corre (BUG-09).
//   caida    la sesión termina en error (modelo inexistente) → ficha fail por session, sin verify (BUG-09).
//   codex    / cursor: como entrega, con el agente real Codex o Cursor (modelo de su config).
//   Fase 2 (salvo --sin-mezcla): las fichas pass se aprueban como humano y el supervisor de mezcla
//   real las mezcla a main; se comprueba main, el checkout del repo y que el hub no se congele.
//   choque-a / choque-b: dos tareas crean choque.txt; la segunda choca al mezclar, recibe el aviso,
//            hace git rebase main y se mezcla tras volver a aprobarse (--agente-choque, codex por defecto).
//   lento    verify de 25 s (--verify-s N para otro largo; con 150 pasa el vigilante de 2 min): el supervisor no se congela mientras corre (BUG-11).
// No toca el registro real de repos ni las tareas del repo de Silka: usa SILKA_CONFIG_DIR temporal
// y vigila solo el repo desechable.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const port = Number(arg('port', 18997));
const agent = arg('agent', 'opencode');
const model = arg('model', 'opencode/hy4-flash-free');
const scenarios = String(arg('escenarios', 'entrega,vacio,caida,lento,codex,cursor,choque-a,choque-b')).split(',').map((s) => s.trim()).filter(Boolean);
const slowSeconds = Number(arg('verify-s', 25));
// --max-sesiones N baja el tope de agent-rack (security.maxConcurrentSessions) para forzar BUG-10.
const maxSessions = Number(arg('max-sesiones', 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Config temporal ANTES de importar Silka: las tareas de prueba no ensucian la config real.
const tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-e2e-cycle-config-'));
process.env.SILKA_CONFIG_DIR = tmpConfig;

const { DashboardRemoteClient } = await import('agent-rack/dist/cli/dashboard/remoteClient.js');
const { tokenFilePath } = await import('agent-rack/dist/security/auth.js');
const { loadSilkaConfig, writeEffectiveAgentRackConfig } = await import('../src/silka/hub.mjs');
const { signalProcessTree } = await import('../src/silka/proc.mjs');
const { gitRun } = await import('../src/silka/tasks/git.mjs');
const { createTaskManager } = await import('../src/silka/tasks/manager.mjs');
const { startTaskSupervisor } = await import('../src/silka/tasks/supervisor.mjs');
const { STATES } = await import('../src/silka/tasks/states.mjs');
const { prepareWorktreeRemoval } = await import('../src/silka/tasks/worktree-cleanup.mjs');
const { removeTaskWorktree } = await import('../src/silka/tasks/worktree.mjs');
const { worktreesBase } = await import('../src/silka/paths.mjs');
const { createReviewService } = await import('../src/silka/review/service.mjs');
const { startMergeSupervisor } = await import('../src/silka/merge/supervisor.mjs');

const { root, config } = loadSilkaConfig();
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-e2e-cycle-repo-'));
gitRun(repo, ['init', '-b', 'main']);
gitRun(repo, ['config', 'user.email', 'e2e@example.com']);
gitRun(repo, ['config', 'user.name', 'e2e']);
fs.writeFileSync(path.join(repo, 'README.md'), 'repo desechable de la prueba e2e de Silka\n');
gitRun(repo, ['add', 'README.md']);
gitRun(repo, ['commit', '-m', 'base']);

const stamp = Date.now().toString(36);
const VERIFY_OK = 'node -e "process.exit(0)"';
const SPECS = {
  entrega: {
    id: `e2e-entrega-${stamp}`,
    title: 'Crear hola.txt',
    scope: 'hola.txt',
    deliver: 'hola.txt con el texto hola',
    prompt: 'Crea en este directorio un archivo llamado hola.txt cuyo contenido sea exactamente: hola\nNo hagas nada más. No hagas commits.',
    verify: 'node -e "process.exit(require(\'fs\').readFileSync(\'hola.txt\',\'utf8\').includes(\'hola\')?0:1)"',
    maxRepairs: 0,
  },
  vacio: {
    id: `e2e-vacio-${stamp}`,
    title: 'No cambiar nada',
    scope: 'nada',
    deliver: 'nada',
    prompt: 'No crees ni modifiques ningún archivo. Responde solo: ok',
    verify: 'node -e "require(\'fs\').writeFileSync(\'verify-corrio.txt\',\'1\')"',
    maxRepairs: 0,
  },
  caida: {
    id: `e2e-caida-${stamp}`,
    title: 'Sesión que falla',
    scope: 'caida.txt',
    deliver: 'caida.txt',
    prompt: 'Crea caida.txt con el texto caida.',
    verify: VERIFY_OK,
    maxRepairs: 0,
    model: 'opencode/modelo-que-no-existe',
  },
  lento: {
    id: `e2e-lento-${stamp}`,
    title: 'Crear lento.txt',
    scope: 'lento.txt',
    deliver: 'lento.txt con el texto lento',
    prompt: 'Crea en este directorio un archivo llamado lento.txt cuyo contenido sea exactamente: lento\nNo hagas nada más. No hagas commits.',
    // Cada comando de verify tiene un tope de 120 s: un verify más largo se parte en tramos de ≤ 90 s.
    verify: Array.from({ length: Math.ceil(slowSeconds / 90) }, (_, i) => {
      const ms = Math.round((slowSeconds * 1000) / Math.ceil(slowSeconds / 90));
      return `node -e "setTimeout(()=>process.exit(0),${ms})" tramo-${i + 1}`;
    }),
    maxRepairs: 0,
  },
  // Mismo encargo con los otros agentes reales (cada uno con el modelo de su config).
  codex: {
    id: `e2e-codex-${stamp}`,
    title: 'Crear codex.txt',
    scope: 'codex.txt',
    deliver: 'codex.txt con el texto codex',
    prompt: 'Crea en este directorio un archivo llamado codex.txt cuyo contenido sea exactamente: codex\nNo hagas nada más. No hagas commits.',
    verify: 'node -e "process.exit(require(\'fs\').readFileSync(\'codex.txt\',\'utf8\').includes(\'codex\')?0:1)"',
    maxRepairs: 0,
    agent: 'codex',
    model: config.agents?.codex?.model,
  },
  cursor: {
    id: `e2e-cursor-${stamp}`,
    title: 'Crear cursor.txt',
    scope: 'cursor.txt',
    deliver: 'cursor.txt con el texto cursor',
    prompt: 'Crea en este directorio un archivo llamado cursor.txt cuyo contenido sea exactamente: cursor\nNo hagas nada más. No hagas commits.',
    verify: 'node -e "process.exit(require(\'fs\').readFileSync(\'cursor.txt\',\'utf8\').includes(\'cursor\')?0:1)"',
    maxRepairs: 0,
    agent: 'cursor',
    // "auto": con el modelo por defecto la cuenta de Cursor responde "You're out of usage. Switch to Auto".
    model: arg('modelo-cursor', config.agents?.cursor?.model || 'auto'),
  },
  // Choque: dos tareas crean el mismo archivo con distinto contenido. La segunda en mezclarse choca
  // con main; Silka le manda el aviso al agente, que debe hacer git rebase main y resolver; vuelve a
  // revisión, se aprueba otra vez y se mezcla.
  'choque-a': {
    id: `e2e-choque-a-${stamp}`,
    title: 'Crear choque.txt (a)',
    scope: 'choque.txt',
    deliver: 'choque.txt con el texto a',
    prompt: 'Crea en este directorio un archivo llamado choque.txt cuyo contenido sea exactamente: a\nNo hagas nada más. No hagas commits.',
    verify: 'node -e "process.exit(require(\'fs\').existsSync(\'choque.txt\')?0:1)"',
    maxRepairs: 1,
  },
  'choque-b': {
    id: `e2e-choque-b-${stamp}`,
    title: 'Crear choque.txt (b)',
    scope: 'choque.txt',
    deliver: 'choque.txt con las líneas a y b',
    prompt: 'Crea en este directorio un archivo llamado choque.txt cuyo contenido sea exactamente: b\nNo hagas nada más. No hagas commits.',
    verify: 'node -e "process.exit(require(\'fs\').existsSync(\'choque.txt\')?0:1)"',
    maxRepairs: 1,
    agent: arg('agente-choque', 'codex'),
    model: config.agents?.[arg('agente-choque', 'codex')]?.model,
  },
};
/** Escenarios cuya ficha debe salir pass y que la fase 2 aprueba y mezcla a main. */
const DELIVERS = new Set(['entrega', 'lento', 'codex', 'cursor', 'choque-a', 'choque-b']);
const FILE_OF = { entrega: 'hola.txt', lento: 'lento.txt', codex: 'codex.txt', cursor: 'cursor.txt', 'choque-a': 'choque.txt', 'choque-b': 'choque.txt' };

let server;
let stopSupervisor = async () => {};
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? '  ok ' : '  MAL'} ${msg}`); if (!cond) failures.push(msg); };
let mgr;
try {
  const security = maxSessions > 0 ? { ...(config.security || {}), maxConcurrentSessions: maxSessions } : config.security;
  const cfgFile = writeEffectiveAgentRackConfig({ ...config, port, ...(security ? { security } : {}) }, port);
  const bin = path.join(root, 'node_modules', 'agent-rack', 'bin', 'agent-rack.js');
  server = spawn(process.execPath, [bin, 'start', '-t', 'sse', '-c', cfgFile], { cwd: root, stdio: ['pipe', 'ignore', 'ignore'] });
  let runtime = null;
  for (let i = 0; i < 80 && !runtime; i += 1) {
    await sleep(250);
    try {
      const r = JSON.parse(fs.readFileSync(tokenFilePath(port), 'utf8'));
      if (r.pid === server.pid) runtime = r;
    } catch { /* aún no */ }
  }
  if (!runtime) throw new Error('agent-rack de prueba no arrancó');
  console.log(`agent-rack real en el puerto ${port} (pid ${server.pid}); repo desechable ${repo}`);

  mgr = createTaskManager(repo, { preferManual: false, maxConcurrentTasks: 4 });
  const specs = scenarios.map((s) => {
    if (!SPECS[s]) throw new Error(`escenario desconocido: ${s}`);
    const spec = { agent, model, ...SPECS[s] };
    if (!spec.model) delete spec.model;
    return spec;
  });
  await mgr.launch(specs, { manual: false, cause: 'e2e' });

  // Mide si el proceso se congela: con spawnSync dentro del supervisor (BUG-11), el temporizador
  // deja de disparar mientras corre el verify.
  let maxLag = 0;
  let last = Date.now();
  const lagTimer = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 200); last = now; }, 200);
  const logs = [];
  stopSupervisor = startTaskSupervisor({
    readRuntime: () => runtime,
    connect: async (rt) => { const c = new DashboardRemoteClient(`http://127.0.0.1:${port}/sse`, rt.token); await c.connect(); return c; },
    repoRoots: [repo],
    log: (m) => { logs.push(m); console.log(`  [hub] ${m}`); },
  });

  const terminal = new Set([STATES.LISTA, STATES.VERIFICACION_FALLIDA, STATES.BLOQUEADA, STATES.DESCARTADA]);
  const deadline = Date.now() + 6 * 60_000 + slowSeconds * 1000;
  let lagDuringVerify = 0;
  while (Date.now() < deadline) {
    await sleep(1000);
    const rows = mgr.list().filter((t) => specs.some((s) => s.id === t.id));
    if (rows.every((t) => terminal.has(t.state))) break;
  }
  clearInterval(lagTimer);
  // Pausa máxima del proceso en todo el ciclo: con spawnSync (BUG-11) el bucle de esta prueba
  // también queda bloqueado, así que no sirve medir "mientras verifica"; se mide todo.
  lagDuringVerify = maxLag;
  await stopSupervisor();
  stopSupervisor = async () => {};

  if (maxSessions > 0) {
    const limitLines = logs.filter((m) => /no da más sesiones|Maximum concurrent sessions/.test(m));
    console.log(`
tope de sesiones ${maxSessions}: ${limitLines.length} aviso(s) de tope en el log`);
    check(limitLines.length === 1, 'tope: se avisa una sola vez');
    check(limitLines.every((m) => /no da más sesiones/.test(m)), 'tope: sin líneas repetidas de "no arrancó"');
  }
  for (const s of scenarios) {
    const t = mgr.list().find((x) => x.id === SPECS[s].id);
    const kinds = (t.card?.evidence || []).map((e) => `${e.kind}:${e.ok ? 'ok' : 'falla'}`).join(' ');
    console.log(`\n${s}: estado ${t.state}, sesión ${t.sessionOutcome || '-'}, ficha ${t.card?.gates || '-'} [${kinds}]`);
    if (t.startError) console.log(`  startError: ${t.startError}`);
    console.log(`  archivos: ${(t.card?.filesAll || []).join(', ') || '(ninguno)'}`);
    if (DELIVERS.has(s)) {
      check(t.state === STATES.LISTA, `${s}: lista_para_revision`);
      check(t.card?.gates === 'pass', `${s}: ficha pass`);
      check(t.card?.evidence?.some((e) => e.kind === 'session' && e.ok), `${s}: evidencia session ok`);
      check(t.card?.evidence?.some((e) => e.kind === 'diff' && e.ok), `${s}: evidencia diff ok`);
      check(t.card?.evidence?.some((e) => e.kind === 'verify' && e.ok), `${s}: verify corrió y pasó`);
    }
    if (s === 'caida') {
      check(t.sessionOutcome && t.sessionOutcome !== 'completed', `caida: la sesión no terminó bien (${t.sessionOutcome})`);
      check(t.state === STATES.VERIFICACION_FALLIDA, 'caida: verificacion_fallida');
      check(t.card?.gates === 'fail', 'caida: ficha fail');
      check(t.card?.evidence?.some((e) => e.kind === 'session' && !e.ok), 'caida: evidencia session falla');
      check(!t.card?.evidence?.some((e) => e.kind === 'verify'), 'caida: el verify no se corrió');
    }
    if (s === 'vacio') {
      check(t.state === STATES.VERIFICACION_FALLIDA, 'vacio: verificacion_fallida');
      check(t.card?.gates === 'fail', 'vacio: ficha fail');
      check(t.card?.evidence?.some((e) => e.kind === 'diff' && !e.ok), 'vacio: evidencia diff falla');
      check(!t.card?.evidence?.some((e) => e.kind === 'verify'), 'vacio: el verify no se corrió');
    }
    if (s === 'lento') {
      check(lagDuringVerify < 2000, `lento: el proceso no se congela durante el verify (pausa máxima ${lagDuringVerify} ms)`);
      check(!logs.some((m) => /colgado/.test(m)), 'lento: el vigilante no lo da por colgado');
    }
  }

  // Fase 2: aprobar (como humano, igual que la bandeja) y dejar que el supervisor de mezcla del hub
  // mezcle a main. Corre junto al supervisor de tareas, como en el hub.
  const toMerge = scenarios.filter((s) => DELIVERS.has(s) && mgr.list().find((x) => x.id === SPECS[s].id)?.state === STATES.LISTA);
  if (toMerge.length && !process.argv.includes('--sin-mezcla')) {
    console.log(`\nfase 2: aprobar y mezclar ${toMerge.join(', ')}`);
    const review = createReviewService(repo, { actor: 'human' });
    for (const s of toMerge) {
      const t = mgr.list().find((x) => x.id === SPECS[s].id);
      try {
        review.approve(t.id, { version: t.version });
      } catch (err) {
        check(false, `${s}: se aprueba (${err.message})`);
      }
    }
    maxLag = 0;
    last = Date.now();
    const lag2 = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 200); last = now; }, 200);
    const connect = async (rt) => { const c = new DashboardRemoteClient(`http://127.0.0.1:${port}/sse`, rt.token); await c.connect(); return c; };
    const hubLogFn = (m) => { logs.push(m); console.log(`  [hub] ${m}`); };
    stopSupervisor = startTaskSupervisor({ readRuntime: () => runtime, connect, repoRoots: [repo], log: hubLogFn });
    const stopMerge = startMergeSupervisor({ readRuntime: () => runtime, connect, repoRoots: [repo], log: hubLogFn });
    const ids = toMerge.map((s) => SPECS[s].id);
    const settled = new Set([STATES.MEZCLADA, STATES.VERIFICACION_FALLIDA, STATES.DESCARTADA, STATES.BLOQUEADA]);
    const deadline2 = Date.now() + 5 * 60_000 + slowSeconds * 2000;
    let lastStates = '';
    const reapproved = new Set();
    const mergeFailures = new Map();
    while (Date.now() < deadline2) {
      await sleep(1000);
      const rows = mgr.list().filter((t) => ids.includes(t.id));
      for (const t of rows) {
        if (t.mergeFailure && !mergeFailures.has(t.id)) mergeFailures.set(t.id, t.mergeFailure);
        // Tras reparar un choque vuelve a revisión: se aprueba otra vez (una sola), como haría el humano.
        if (t.state === STATES.LISTA && !reapproved.has(t.id)) {
          reapproved.add(t.id);
          console.log(`  ${t.id}: vuelve a revisión tras reparar (ficha ${t.card?.gates}); se aprueba de nuevo`);
          try { review.approve(t.id, { version: t.version }); } catch (err) { console.log(`  no se pudo aprobar: ${err.message}`); }
        }
      }
      const now = rows.map((t) => `${t.id.replace(/-[a-z0-9]+$/, '')}:${t.state}`).join(' ');
      if (now !== lastStates) { console.log(`  estados: ${now}`); lastStates = now; }
      if (rows.every((t) => settled.has(t.state))) break;
    }
    clearInterval(lag2);
    await stopMerge();
    await stopSupervisor();
    stopSupervisor = async () => {};
    const mainFiles = gitRun(repo, ['ls-tree', '-r', '--name-only', 'main'], { repoRoot: repo }).stdout.split(/\r?\n/).filter(Boolean);
    const log = gitRun(repo, ['log', '--format=%s', 'main'], { repoRoot: repo }).stdout.trim().split(/\r?\n/);
    console.log(`  main: ${mainFiles.join(', ')}`);
    console.log(`  commits: ${log.join(' | ')}`);
    for (const s of toMerge) {
      const t = mgr.list().find((x) => x.id === SPECS[s].id);
      if (t.mergeFailure) console.log(`  ${s} mergeFailure: ${JSON.stringify(t.mergeFailure).slice(0, 400)}`);
      check(t.state === STATES.MEZCLADA, `${s}: mezclada (estado ${t.state})`);
      check(mainFiles.includes(FILE_OF[s]), `${s}: ${FILE_OF[s]} está en main`);
      check(!t.worktreePath, `${s}: su worktree se limpió`);
    }
    check(!mainFiles.some((f) => f.startsWith('.silka/')), 'mezcla: nada de .silka/ en main');
    if (toMerge.includes('choque-b') && toMerge.includes('choque-a')) {
      const b = mgr.list().find((x) => x.id === SPECS['choque-b'].id);
      const failure = mergeFailures.get(b.id);
      console.log(`  choque-b: falla de mezcla vista ${JSON.stringify(failure || null).slice(0, 200)}; reparaciones ${b.repairCount || 0}`);
      check(failure?.kind === 'conflict', 'choque: la segunda tarea choca con main (conflict)');
      check((b.repairCount || 0) >= 1, 'choque: se le mandó el aviso de reparación al agente');
      const content = fs.existsSync(path.join(repo, 'choque.txt')) ? fs.readFileSync(path.join(repo, 'choque.txt'), 'utf8') : '';
      console.log(`  choque.txt en main: ${JSON.stringify(content)}`);
    }
    const status = gitRun(repo, ['status', '--porcelain'], { repoRoot: repo }).stdout.trim();
    check(toMerge.every((s) => fs.existsSync(path.join(repo, FILE_OF[s]))), 'mezcla: el checkout del repo quedó al día con main');
    console.log(`  status del repo: ${status || '(limpio)'}`);
    check(maxLag < 2000, `mezcla: el proceso no se congela (pausa máxima ${maxLag} ms)`);
  }
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(`FALLÓ: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await stopSupervisor().catch(() => {});
  if (server) signalProcessTree(server.pid, { force: true });
  try { fs.rmSync(tokenFilePath(port), { force: true }); } catch { /* ya no está */ }
  for (const t of mgr?.list() || []) {
    if (!t.worktreePath) continue;
    prepareWorktreeRemoval(repo, t.worktreePath);
    removeTaskWorktree(repo, t.id, t.worktreePath);
  }
  gitRun(repo, ['worktree', 'prune'], { repoRoot: repo });
  try { fs.rmdirSync(worktreesBase(repo)); } catch { /* no estaba vacía o ya no está */ }
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* queda en %TEMP% */ }
  try { fs.rmSync(tmpConfig, { recursive: true, force: true }); } catch { /* queda en %TEMP% */ }
}
console.log(failures.length ? `\nRESULTADO: FALLA (${failures.length})` : '\nRESULTADO: OK');
process.exit(failures.length ? 1 : 0);
