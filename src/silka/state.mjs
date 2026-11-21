import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { graphHint } from './graph.mjs';
import { withFileLock, writeAtomic } from './lock.mjs';
import { appendNote } from './notes.mjs';
import { originLabel } from './origin.mjs';

const TWO_HOURS = 2 * 60 * 60 * 1000;
export const HEADER = 'Estado del proyecto (silka)';

export function silkaDir(workspace) {
  return path.join(path.resolve(workspace), '.silka');
}

function tasksFile(workspace) {
  return path.join(silkaDir(workspace), 'tasks.json');
}

function decisionsFile(workspace) {
  return path.join(silkaDir(workspace), 'decisions.jsonl');
}

function withLock(workspace, fn) {
  const dir = silkaDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  return withFileLock(path.join(dir, '.lock'), fn);
}

function emptyStore() {
  return { tasks: [], conflicts: [] };
}

function pidAlive(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return true; // tareas viejas sin pid: no se tocan
  try { process.kill(id, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

/** Una tarea 'running' cuyo shim ya no existe (cancelada o muerta) se cierra como 'cancelled'. */
export function reapDeadTasks(tasks, alive = pidAlive) {
  for (const task of tasks) {
    if (task?.status === 'running' && !alive(task.pid)) {
      task.status = 'cancelled';
      task.finishedAt = task.finishedAt || new Date().toISOString();
    }
  }
  return tasks;
}

export function readStore(workspace) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tasksFile(workspace), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      tasks: Array.isArray(parsed.tasks) ? reapDeadTasks(parsed.tasks) : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(workspace, store) {
  writeAtomic(tasksFile(workspace), `${JSON.stringify(store, null, 2)}\n`);
}

export function readDecisions(workspace) {
  try {
    return fs.readFileSync(decisionsFile(workspace), 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row && typeof row === 'object' ? [row] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function oneLine(value, max = 88) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (value) => path.resolve(String(value)).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  return { ok: result.status === 0, out: String(result.stdout || '').replace(/\r/g, '') };
}

export function repoInfo(workspace) {
  const inside = git(workspace, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out.trim() !== 'true') return null;
  const branch = git(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  const head = git(workspace, ['rev-parse', 'HEAD']);
  return {
    branch: branch || 'HEAD',
    head: head.ok ? head.out.trim() : '',
  };
}

function hashFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    if (stat.size > 2_000_000) return `size:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    const data = fs.readFileSync(file);
    return crypto.createHash('sha1').update(data).digest('hex');
  } catch {
    return null;
  }
}

function parsePorcelain(text) {
  const files = {};
  for (const line of String(text || '').split('\n')) {
    if (line.length < 4) continue;
    let file = line.slice(3);
    const arrow = file.lastIndexOf(' -> ');
    if (arrow >= 0) file = file.slice(arrow + 4);
    file = file.replaceAll('\\', '/').replace(/^"+|"+$/g, '');
    if (!file || file.endsWith('/')) continue;
    if (file === '.silka' || file.startsWith('.silka/') || file === '.git' || file.startsWith('.git/') || file.startsWith('graphify-out/')) continue;
    files[file] = { code: line.slice(0, 2) };
  }
  return files;
}

export function captureFiles(workspace) {
  const info = repoInfo(workspace);
  if (!info) return null;
  const status = git(workspace, ['status', '--porcelain=v1', '-uall']);
  const files = status.ok ? parsePorcelain(status.out) : {};
  for (const [rel, row] of Object.entries(files)) {
    row.hash = hashFile(path.join(workspace, rel));
  }
  return { ...info, files };
}

export function changedPaths(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const key of keys) {
    const left = before?.[key];
    const right = after?.[key];
    if (!left || !right || left.hash !== right.hash || left.code !== right.code) out.push(key);
  }
  return out.sort();
}

function overlaps(a, b) {
  const startA = Date.parse(a.startedAt);
  const endA = Date.parse(a.finishedAt || '') || Date.now();
  const startB = Date.parse(b.startedAt);
  const endB = Date.parse(b.finishedAt || '') || Date.now();
  if (!Number.isFinite(startA) || !Number.isFinite(startB)) return false;
  return startA <= endB && startB <= endA;
}

export function attributeChanges(self, peers, changed, endFiles) {
  const already = new Set(Object.keys(self.start?.files || {}));
  const fresh = (changed || []).filter((file) => !already.has(file));
  const active = (peers || []).some((peer) => peer.status === 'running' && overlaps(self, peer));
  if (active) return { files: [], ambiguous: fresh };
  const files = [];
  const ambiguous = [];
  for (const file of fresh) {
    const hit = (peers || []).filter((peer) => {
      if (!overlaps(self, peer)) return false;
      if ((peer.files || []).includes(file) || (peer.ambiguous || []).includes(file)) return true;
      if (peer.status === 'running' && peer.start?.files) {
        const start = peer.start.files[file];
        const end = endFiles?.[file];
        return (start?.hash ?? null) !== (end?.hash ?? null) || (start?.code ?? null) !== (end?.code ?? null);
      }
      return false;
    });
    if (hit.length) ambiguous.push(file);
    else files.push(file);
  }
  return { files, ambiguous };
}

function fileList(files, max = 3) {
  const list = (files || []).filter(Boolean).map((file) => oneLine(file, 40));
  if (!list.length) return '';
  const shown = list.slice(0, max).join(', ');
  const extra = list.length - max;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

function taskFiles(task) {
  return [...new Set([...(task.files || []), ...(task.ambiguous || [])])]
    .filter((file) => !String(file).startsWith('.silka/') && !String(file).startsWith('.git/') && !String(file).startsWith('graphify-out/'));
}

export function formatBlock(workspace, { excludeId } = {}) {
  const store = readStore(workspace);
  const repo = repoInfo(workspace);
  const since = new Date(Date.now() - TWO_HOURS).toISOString();
  const tasks = store.tasks || [];
  const others = tasks
    .filter((task) => task.id !== excludeId && task.finishedAt && task.finishedAt >= since)
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const active = tasks.filter((task) => task.status === 'running' && task.id !== excludeId);
  const decisions = readDecisions(workspace).slice(-3).reverse();
  const graph = graphHint(workspace);
  const lines = [HEADER];
  lines.push(repo
    ? `${repo.branch} @ ${repo.head ? repo.head.slice(0, 7) : 'sin commits'}`
    : 'sin repo git');
  const tail = [];
  for (const task of active.slice(0, 4)) {
    const files = fileList(taskFiles(task));
    tail.push(`en curso: ${task.agent}${files ? ` [${files}]` : ''}`);
  }
  for (const decision of decisions.slice(0, 3)) tail.push(`decisión: ${oneLine(decision.text, 72)}`);
  if (graph) tail.push(graph);
  const room = Math.max(0, 15 - lines.length - tail.length);
  const limit = lines.length + room;
  const seen = new Set();
  for (const task of others) {
    if (lines.length >= limit) break;
    const files = fileList(taskFiles(task)) || 'sin cambios';
    const key = `${task.agent} ${files}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = oneLine(task.summary, 48);
    lines.push(`otros: ${task.agent} ${files}${summary ? ` — ${summary}` : ''}`);
  }
  lines.push(...tail);
  return lines.slice(0, 15).join('\n');
}

export function beginTurn({ workspace, agent, from, prompt }) {
  const dir = path.resolve(workspace);
  const snap = captureFiles(dir);
  const id = crypto.randomUUID();
  const task = {
    id,
    agent: originLabel(agent),
    from: originLabel(from || 'tú'),
    branch: snap?.branch || '',
    base: snap?.head || '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    pid: process.pid,
    files: [],
    ambiguous: [],
    summary: oneLine(prompt, 80),
    workspace: dir,
    start: snap ? { files: snap.files } : null,
  };
  withLock(dir, () => {
    const store = readStore(dir);
    store.tasks.push(task);
    writeStore(dir, store);
  });
  const block = formatBlock(dir, { excludeId: id });
  const body = String(prompt ?? '').replaceAll(HEADER, 'Estado del proyecto (texto)');
  return { id, block, prompt: `${block}\n\n${body}` };
}

function conflictKey(file, taskIds) {
  return `${file}|${[...taskIds].sort().join(',')}`;
}

function conflictText(file, tasks) {
  const names = tasks.map((task) => `${task.agent} ${String(task.id).slice(0, 8)}`).join(' y ');
  return `Conflicto: ${names || 'dos tareas'} tocan ${file} a la vez.`;
}

export function matchTaskSession(task, sessions) {
  const pool = (sessions || []).filter((session) => samePath(session.workspace, task.workspace || ''));
  const sameAgent = pool.filter((session) => originLabel(session.agentId) === originLabel(task.agent));
  const list = sameAgent.length ? sameAgent : pool;
  if (!list.length) return null;
  const target = Date.parse(task.startedAt);
  return [...list].sort((a, b) => {
    const da = Math.abs(Date.parse(a.createdAt) - target);
    const db = Math.abs(Date.parse(b.createdAt) - target);
    return (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
  })[0];
}

function rememberConflicts(workspace, store, found, sessions) {
  let wrote = false;
  for (const item of found) {
    const key = conflictKey(item.file, item.taskIds);
    let row = store.conflicts.find((conflict) => conflict.key === key);
    if (!row) {
      row = { key, file: item.file, taskIds: item.taskIds, at: new Date().toISOString(), noted: false };
      store.conflicts.push(row);
      wrote = true;
    }
    const tasks = item.taskIds.map((id) => store.tasks.find((task) => task.id === id)).filter(Boolean)
      .map((task) => ({ ...task, workspace: task.workspace || workspace }));
    const sessionIds = [...new Set(tasks.map((task) => matchTaskSession(task, sessions)?.sessionId).filter(Boolean))];
    row.sessions = Array.isArray(row.sessions) ? row.sessions : [];
    const targets = sessionIds.length ? sessionIds : (row.sessions.length ? [] : ['manager']);
    const text = conflictText(item.file, tasks);
    for (const sessionId of targets) {
      if (row.sessions.includes(sessionId)) continue;
      appendNote({ sessionId, text });
      row.sessions.push(sessionId);
      wrote = true;
    }
    row.noted = row.sessions.length > 0;
  }
  return wrote;
}

export function refreshConflicts(workspace, sessions = []) {
  const dir = path.resolve(workspace);
  return withLock(dir, () => {
    const store = readStore(dir);
    const snap = captureFiles(dir);
    const live = snap ? liveConflicts(store.tasks, snap.files) : [];
    const found = [...live];
    for (const task of store.tasks) {
      for (const file of task.ambiguous || []) {
        const peers = store.tasks.filter((other) => other.id !== task.id && overlaps(task, other)
          && ((other.files || []).includes(file) || (other.ambiguous || []).includes(file) || other.status === 'running'));
        if (!peers.length) continue;
        found.push({ file, taskIds: [task.id, ...peers.map((peer) => peer.id)] });
      }
    }
    if (rememberConflicts(dir, store, found, sessions.map((session) => ({ ...session, workspace: session.workspace || dir })))) {
      writeStore(dir, store);
    } else if (live.length && store.conflicts.length) {
      writeStore(dir, store);
    }
    return store.conflicts;
  });
}

export function liveConflicts(tasks, endFiles) {
  const running = (tasks || []).filter((task) => task.status === 'running' && task.start?.files);
  const map = new Map();
  for (const task of running) {
    for (const file of changedPaths(task.start.files, endFiles)) {
      if (!map.has(file)) map.set(file, []);
      map.get(file).push(task.id);
    }
  }
  return [...map.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([file, taskIds]) => ({ file, taskIds }));
}

export function finishTurn({ workspace, id, status, summary }) {
  if (!id) return null;
  const dir = path.resolve(workspace);
  const end = captureFiles(dir);
  let finished = null;
  withLock(dir, () => {
    const store = readStore(dir);
    const task = store.tasks.find((item) => item.id === id);
    if (!task) return;
    const peers = store.tasks.filter((item) => item.id !== id);
    const changed = end && task.start?.files ? changedPaths(task.start.files, end.files) : [];
    const owned = attributeChanges(
      { ...task, finishedAt: new Date().toISOString(), status: status || 'done' },
      peers,
      changed,
      end?.files || {},
    );
    task.files = owned.files;
    task.ambiguous = owned.ambiguous;
    task.status = status === 'failed' ? 'failed' : 'done';
    task.finishedAt = new Date().toISOString();
    if (summary) task.summary = oneLine(summary, 80);
    delete task.start;
    const found = [];
    for (const file of task.ambiguous) {
      const peersHit = peers.filter((other) => overlaps(task, other)
        && ((other.files || []).includes(file) || (other.ambiguous || []).includes(file) || other.status === 'running'));
      if (peersHit.length) found.push({ file, taskIds: [task.id, ...peersHit.map((peer) => peer.id)] });
    }
    rememberConflicts(dir, store, found, []);
    writeStore(dir, store);
    finished = task;
  });
  return finished;
}

export function appendDecision({ workspace, text, author, sessionId }) {
  const row = {
    at: new Date().toISOString(),
    author: originLabel(author || 'tú'),
    sessionId: String(sessionId || ''),
    text: String(text ?? '').trim(),
  };
  if (!row.text) throw new Error('La decisión está vacía.');
  const dir = path.resolve(workspace);
  withLock(dir, () => {
    const file = decisionsFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  });
  return row;
}

export function changesSince(workspace, since) {
  const when = since ? new Date(since) : new Date(Date.now() - TWO_HOURS);
  if (Number.isNaN(when.getTime())) throw new Error('since tiene que ser una fecha ISO.');
  const iso = when.toISOString();
  const store = readStore(workspace);
  return store.tasks
    .filter((task) => {
      const at = task.finishedAt || task.startedAt;
      return at && at >= iso && (task.files?.length || task.ambiguous?.length || task.status === 'running');
    })
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

export function formatChanges(workspace, since) {
  const when = since ? new Date(since) : new Date(Date.now() - TWO_HOURS);
  const tasks = changesSince(workspace, since);
  const lines = [`cambios desde ${when.toISOString()}`];
  if (!tasks.length) lines.push('sin cambios de agentes en esa ventana');
  for (const task of tasks.slice(-12)) {
    const files = fileList(taskFiles(task)) || 'sin archivos';
    const mark = task.ambiguous?.length ? ' (ambiguo)' : '';
    lines.push(`${task.agent} ${files}${mark} — ${oneLine(task.summary, 60) || task.status}`);
  }
  return lines.join('\n');
}

export function formatDecisions(workspace, limit = 10) {
  const count = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 10;
  const rows = readDecisions(workspace).slice(-count);
  if (!rows.length) return 'sin decisiones';
  return rows.map((row) => `${row.at} ${row.author}${row.sessionId ? ` ${String(row.sessionId).slice(0, 8)}` : ''}: ${oneLine(row.text, 120)}`).join('\n');
}

export function workspaceReport(workspace) {
  const dir = path.resolve(workspace);
  const repo = repoInfo(dir);
  const store = readStore(dir);
  const decisions = readDecisions(dir).slice(-8).reverse();
  const conflicts = store.conflicts || [];
  return {
    workspace: dir,
    repo,
    tasks: store.tasks,
    conflicts,
    decisions,
    graph: graphHint(dir),
    block: formatBlock(dir),
  };
}
