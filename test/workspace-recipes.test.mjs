// Escenarios de openspec/changes/workspace-recipes/specs/isolated-tasks/spec.md (WR-01 a WR-05).
// Los de Windows con servidor vivo (WR-04) usan procesos reales y solo corren en win32.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTaskManager } from '../src/silka/tasks/manager.mjs';
import { createTaskWorktree, removeTaskWorktree, worktreePath } from '../src/silka/tasks/worktree.mjs';
import { allocatePorts, portsAreFree, releasePorts } from '../src/silka/tasks/ports.mjs';
import {
  commandsFor,
  expandCommand,
  pickVariant,
  readRecipe,
  shellInvocation,
  validateRecipe,
  workspaceEnv,
} from '../src/silka/tasks/recipe.mjs';
import { copyWorkspaceFiles, startWorkspaceRun, stopWorkspaceRun, isPidAlive } from '../src/silka/tasks/workspace.mjs';
import { spawnShellCommand } from '../src/silka/tasks/verify.mjs';

const WIN = process.platform === 'win32';
const OK = 'node -e "process.exit(0)"';

function initRepo(gitignore = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-wr-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  if (gitignore) fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  git('add', '-A');
  git('commit', '-m', 'base');
  return dir;
}

function headCommit(repo) {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
}

function baseTask(overrides = {}) {
  return { title: 't', scope: 'src/', deliver: 'x', verify: OK, ...overrides };
}

function writeRecipe(repo, recipe) {
  fs.writeFileSync(path.join(repo, 'silka.json'), `${JSON.stringify(recipe, null, 2)}\n`);
}

async function waitFor(fn, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// --- WR-01: esquema de la receta y variantes ------------------------------------------------

test('WR-01: la receta válida se normaliza y el esquema rechaza lo que no encaja', () => {
  const ok = validateRecipe({
    setup: { win: 'npm ci', posix: ['npm ci', 'npm run build'] },
    run: { dev: 'npm run dev' },
    archive: 'node scripts/cleanup.mjs',
    copy: ['.env*'],
    ports: 4,
    runMode: 'exclusive',
    shell: 'bash',
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.recipe.ports, 4);
  assert.equal(ok.recipe.runMode, 'exclusive');

  const defaults = validateRecipe({});
  assert.equal(defaults.recipe.ports, 10, 'por defecto 10 puertos por tarea');
  assert.equal(defaults.recipe.runMode, 'concurrent');

  const bad = validateRecipe({ runmode: 'exclusive', ports: 0, shell: 'zsh', run: { 'mal nombre': 'x' }, setup: { mac: 'x' } });
  assert.ok(bad.errors.some((e) => /clave desconocida: runmode/.test(e)));
  assert.ok(bad.errors.some((e) => /ports/.test(e)));
  assert.ok(bad.errors.some((e) => /shell/.test(e)));
  assert.ok(bad.errors.some((e) => /nombre no válido/.test(e)));
  assert.ok(bad.errors.some((e) => /variantes desconocidas/.test(e)));
  assert.equal(bad.recipe, null);
});

test('WR-01: un silka.json que no parsea no se ignora en silencio', () => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, 'silka.json'), '{ no es json');
  const r = readRecipe(repo);
  assert.equal(r.present, true);
  assert.equal(r.recipe, null);
  assert.match(r.errors[0], /no es JSON válido/);
  assert.equal(readRecipe(initRepo()).present, false, 'sin archivo, comportamiento de antes');
});

test('WR-01: las variantes se eligen por plataforma y expandCommand sustituye ${NAME}', () => {
  assert.equal(pickVariant({ win: 'a', posix: 'b' }, 'win32'), 'a');
  assert.equal(pickVariant({ win: 'a', posix: 'b' }, 'linux'), 'b');
  assert.equal(pickVariant({ win: 'a' }, 'linux'), null, 'sin variante posix no hay comando');
  assert.deepEqual(commandsFor(['x', ' ', 'y'], 'linux'), ['x', 'y']);
  assert.equal(expandCommand('echo ${SILKA_PORT} ${OTRO}', { SILKA_PORT: '19000' }), 'echo 19000 ${OTRO}');
});

test('WR-01: cada shell declarado se construye con su ejecutable', () => {
  assert.equal(shellInvocation('cmd', 'echo hola', 'win32').file, 'cmd.exe');
  assert.equal(shellInvocation('cmd', 'echo hola', 'win32').verbatim, true);
  assert.throws(() => shellInvocation('cmd', 'echo', 'linux'), /solo existe en Windows/);
  assert.equal(shellInvocation('bash', 'echo', 'linux').file, 'bash');
});

test('WR-01: el mismo comando con ${SILKA_PORT} da la misma salida en cada shell', { skip: !WIN && 'shells de Windows' }, async () => {
  const repo = initRepo();
  const env = { SILKA_PORT: '19123' };
  const shells = ['cmd', 'pwsh'];
  const bashFound = spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.includes('Git');
  if (bashFound) shells.push('bash');
  for (const shell of shells) {
    // node y no `echo`: en pwsh, `echo a b` imprime dos líneas; con node la salida es la misma en los tres.
    const r = spawnShellCommand(repo, `node -e "console.log('puerto \${SILKA_PORT}')"`, { shell, env, timeoutMs: 30_000 });
    assert.equal(r.status, 0, `${shell}: ${r.stderr}`);
    assert.match(String(r.stdout), /puerto 19123/, `${shell} expande la variable`);
  }
});

// --- WR-02: copia respetando la denegación -------------------------------------------------

test('WR-02: copy trae el .env.local y no el .env.production denegado', () => {
  const repo = initRepo('.env*\n');
  fs.writeFileSync(path.join(repo, '.env.local'), 'LOCAL=1\n');
  fs.writeFileSync(path.join(repo, '.env.production'), 'PROD=1\n');
  const wt = createTaskWorktree(repo, 'wr-copy', headCommit(repo), { denylist: [] }).worktreePath;
  try {
    const r = copyWorkspaceFiles(repo, wt, { copy: ['.env*'] }, { denylist: ['.env.production'] });
    assert.ok(r.copied.includes('.env.local'));
    assert.ok(!r.copied.includes('.env.production'));
    assert.ok(fs.existsSync(path.join(wt, '.env.local')));
    assert.ok(!fs.existsSync(path.join(wt, '.env.production')));
    assert.ok(r.skipped.some((s) => s.file === '.env.production' && /secretos/.test(s.reason)));
  } finally {
    removeTaskWorktree(repo, 'wr-copy', wt);
  }
});

test('WR-02: con la lista por defecto, .env* queda denegado y .worktreeinclude suma rutas literales', () => {
  const repo = initRepo('.env*\nconfig/local.json\n');
  fs.writeFileSync(path.join(repo, '.env.local'), 'LOCAL=1\n');
  fs.mkdirSync(path.join(repo, 'config'));
  fs.writeFileSync(path.join(repo, 'config', 'local.json'), '{}');
  fs.writeFileSync(path.join(repo, '.worktreeinclude'), '# notas\nconfig/local.json\n');
  const wt = createTaskWorktree(repo, 'wr-inc', headCommit(repo), { denylist: [] }).worktreePath;
  try {
    const r = copyWorkspaceFiles(repo, wt, { copy: ['.env*'] }, { denylist: ['.env*'] });
    assert.deepEqual(r.copied, ['config/local.json']);
    assert.ok(fs.existsSync(path.join(wt, 'config', 'local.json')));
    assert.ok(r.skipped.some((s) => s.file === '.env.local'));
  } finally {
    removeTaskWorktree(repo, 'wr-inc', wt);
  }
});

// --- WR-03: puertos y variables por tarea --------------------------------------------------

test('WR-03: dos tareas que piden puertos a la vez reciben rangos contiguos sin solaparse', () => {
  const repo = initRepo();
  const a = allocatePorts(repo, 'wr-a', 10);
  const b = allocatePorts(repo, 'wr-b', 10);
  assert.equal(a.length, 10);
  assert.equal(b.length, 10);
  for (let i = 1; i < a.length; i += 1) assert.equal(a[i], a[i - 1] + 1, 'rango contiguo');
  assert.ok(a.every((p) => !b.includes(p)), 'sin solapamiento');
  releasePorts(repo, 'wr-a');
  releasePorts(repo, 'wr-b');
});

test('WR-03: un puerto ocupado por un servidor ajeno se salta', async () => {
  const repo = initRepo();
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(19000, '127.0.0.1', resolve);
  }).catch(() => {});
  try {
    const block = allocatePorts(repo, 'wr-busy', 5);
    assert.ok(!block.includes(19000), 'el bloque evita el puerto ocupado');
    assert.ok(portsAreFree(block));
  } finally {
    await new Promise((r) => blocker.close(r));
    releasePorts(repo, 'wr-busy');
  }
});

test('WR-03: el entorno de la tarea trae SILKA_PORT y las variables estándar', () => {
  const env = workspaceEnv({
    taskId: 'tk-1',
    worktreePath: path.join(os.tmpdir(), 'wt'),
    rootPath: path.join(os.tmpdir(), 'repo'),
    workspaceName: 'repo',
    defaultBranch: 'main',
    ports: [19010, 19011],
  });
  assert.equal(env.SILKA_PORT, '19010');
  assert.equal(env.SILKA_PORT_2, '19011');
  assert.equal(env.SILKA_TASK_ID, 'tk-1');
  assert.equal(env.SILKA_WORKSPACE_NAME, 'repo');
  assert.equal(env.SILKA_DEFAULT_BRANCH, 'main');
  assert.ok(env.SILKA_WORKSPACE_PATH && env.SILKA_ROOT_PATH);
});

test('WR-03: con receta, el manager copia lo que no es secreto y asigna el rango de puertos', async () => {
  const repo = initRepo('.env*\n');
  writeRecipe(repo, {
    copy: ['.env.local', '.env.example'],
    ports: 3,
    setup: `node -e "require('fs').writeFileSync('setup-env.txt', process.env.SILKA_TASK_ID + ' ' + process.env.SILKA_PORT)"`,
  });
  spawnSync('git', ['add', 'silka.json'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'receta'], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.env.local'), 'LOCAL=1\n');
  fs.writeFileSync(path.join(repo, '.env.example'), 'EXAMPLE=1\n');
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 2 });
  await mgr.launch([baseTask({ id: 'wr-m1', title: 'uno' })]);
  const row = mgr.list().find((t) => t.id === 'wr-m1');
  try {
    assert.equal(row.allocatedPorts.length, 3, 'rango de la receta');
    // La lista por defecto deniega .env* (salvo .env.example): un .env.local secreto NO llega al worktree.
    assert.ok(!fs.existsSync(path.join(row.worktreePath, '.env.local')), 'secreto denegado, no copiado');
    assert.ok(fs.existsSync(path.join(row.worktreePath, '.env.example')), 'lo no secreto sí se copia');
    assert.ok(mgr.envFor(row).SILKA_PORT, 'SILKA_PORT expuesto');
    assert.equal(mgr.envFor(row).SILKA_TASK_ID, 'wr-m1');
  } finally {
    mgr.cleanupTask('wr-m1');
  }
});

// --- WR-04: run, stop y archive con procesos reales -----------------------------------------

for (const shell of ['cmd', 'pwsh']) {
  test(`WR-04: run con servidor vivo (${shell}) y stop cierra el árbol y libera el puerto`, { skip: !WIN && 'cierre de árbol probado en Windows' }, async () => {
    const repo = initRepo();
    const id = `wr-run-${shell}`;
    const wt = createTaskWorktree(repo, id, headCommit(repo), { denylist: [] }).worktreePath;
    const ports = allocatePorts(repo, id, 1);
    try {
      // shell -> node: el servidor es nieto del shell, así que el cierre tiene que alcanzarlo por el árbol.
      // pwsh se prueba aparte: con `detached` en Windows, powershell.exe muere al lanzarlo (ya corregido).
      startWorkspaceRun({
        repoRoot: repo,
        wt,
        name: 'dev',
        command: 'node -e "require(\'http\').createServer(() => {}).listen(${SILKA_PORT})"',
        shell,
        env: { SILKA_PORT: String(ports[0]) },
      });
      const up = await waitFor(() => !portsAreFree(ports));
      assert.ok(up, 'el servidor escucha en su puerto');
      const pid = JSON.parse(fs.readFileSync(path.join(wt, '.silka', 'runs', 'dev.json'), 'utf8')).pid;

      const stopped = stopWorkspaceRun(wt, 'dev', { ports });
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.portsFree, true, 'el puerto queda libre tras el cierre');
      assert.equal(isPidAlive(pid), false, 'el proceso del run ya no vive');
    } finally {
      stopWorkspaceRun(wt, 'dev', { ports });
      releasePorts(repo, id);
      removeTaskWorktree(repo, id, wt);
    }
  });
}

test('WR-04: archive detiene el run, corre el comando archive, quita el worktree y deja node_modules intacto', { skip: !WIN && 'Windows' }, async () => {
  const repo = initRepo();
  fs.mkdirSync(path.join(repo, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  const marker = path.join(repo, 'archive-ran.txt');
  writeRecipe(repo, {
    ports: 1,
    run: { dev: 'node -e "setInterval(() => {}, 1000)"' },
    archive: `node -e "require('fs').writeFileSync(process.env.SILKA_ROOT_PATH + '/archive-ran.txt', 'ok')"`,
  });
  spawnSync('git', ['add', 'silka.json'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'receta'], { cwd: repo });
  const mgr = createTaskManager(repo, { maxConcurrentTasks: 2 });
  await mgr.launch([baseTask({ id: 'wr-arch', title: 'arch' })]);
  const row = mgr.list().find((t) => t.id === 'wr-arch');
  const wt = row.worktreePath;
  mgr.startTaskRun('wr-arch', 'dev');
  try {
    assert.equal(mgr.listTaskRuns('wr-arch').filter((r) => r.alive).length, 1);
    const res = mgr.archiveTaskWorkspace('wr-arch');
    assert.equal(res.stops[0].stopped, true);
    assert.equal(res.archive[0].ok, true, 'comando archive ejecutado');
    assert.ok(fs.existsSync(marker), 'el archive vio SILKA_ROOT_PATH');
    assert.equal(res.worktreeRemoved, true, 'worktree quitado sin EBUSY');
    assert.ok(fs.existsSync(path.join(repo, 'node_modules', 'pkg', 'index.js')), 'node_modules del repo intacto');
  } finally {
    if (fs.existsSync(wt)) removeTaskWorktree(repo, 'wr-arch', wt);
  }
});

// --- WR-05: runMode exclusive --------------------------------------------------------------

test('WR-05: con runMode exclusive un segundo run se rechaza con el motivo', async () => {
  const repo = initRepo();
  writeRecipe(repo, { runMode: 'exclusive', run: { dev: 'node -e "setInterval(() => {}, 1000)"' } });
  const wtA = createTaskWorktree(repo, 'wr-ex-a', headCommit(repo), { denylist: [] }).worktreePath;
  const wtB = createTaskWorktree(repo, 'wr-ex-b', headCommit(repo), { denylist: [] }).worktreePath;
  try {
    startWorkspaceRun({ repoRoot: repo, wt: wtA, name: 'dev', command: 'node -e "setInterval(() => {}, 1000)"', runMode: 'exclusive' });
    assert.throws(
      () => startWorkspaceRun({ repoRoot: repo, wt: wtB, name: 'dev', command: 'node -e "setInterval(() => {}, 1000)"', runMode: 'exclusive' }),
      /runMode exclusive: ya corre "dev" de la tarea wr-ex-a/,
    );
    const again = startWorkspaceRun({ repoRoot: repo, wt: wtB, name: 'otro', command: 'node -e "0"', runMode: 'concurrent' });
    assert.ok(again.pid, 'concurrent no bloquea');
  } finally {
    stopWorkspaceRun(wtA, 'dev');
    stopWorkspaceRun(wtB, 'dev');
    stopWorkspaceRun(wtB, 'otro');
    removeTaskWorktree(repo, 'wr-ex-a', wtA);
    removeTaskWorktree(repo, 'wr-ex-b', wtB);
  }
});
