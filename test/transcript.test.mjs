import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { beginTurn, readStore } from '../src/silka/state.mjs';
import {
  associateTurn,
  createTurnLog,
  readConversation,
  sessionTranscriptPath,
  turnTranscriptPath,
} from '../src/silka/transcript.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-transcript-'));
process.env.SILKA_CONFIG_DIR = root;

function session(id, agent, workspace, createdAt) {
  return { sessionId: id, agentId: agent, workspace, createdAt, status: 'running', turnCount: 1 };
}

test('associateTurn une el turno con la sesión del mismo agente más cercana', () => {
  const workspace = 'C:/repo';
  const startedAt = '2026-11-21T00:00:10.000Z';
  const task = { id: 'turn-a', agent: 'opencode', workspace, startedAt, status: 'running' };
  const far = session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'opencode', workspace, '2026-11-21T00:00:00.000Z');
  const near = session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'opencode', workspace, '2026-11-21T00:00:10.200Z');
  const other = session('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cursor', workspace, '2026-11-21T00:00:10.100Z');
  assert.equal(associateTurn(task, [far, other, near]), near.sessionId);
  assert.equal(associateTurn({ ...task, workspace: 'C:/otro' }, [near]), '');
});

test('associateTurn desempatan dos sesiones casi juntas y no pisa un turno ya ligado', () => {
  const workspace = 'C:/repo';
  const startedAt = '2026-11-21T00:00:10.000Z';
  const task = { id: 'turn-b', agent: 'codex', workspace, startedAt, status: 'running' };
  const first = session('dddddddd-dddd-dddd-dddd-dddddddddddd', 'codex', workspace, '2026-11-21T00:00:10.000Z');
  const second = session('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'codex', workspace, '2026-11-21T00:00:10.400Z');
  const claimed = new Map([[first.sessionId, 'turn-otro']]);
  assert.equal(associateTurn(task, [first, second], claimed), second.sessionId);
  assert.equal(associateTurn({ ...task, sessionId: first.sessionId }, [second]), first.sessionId);
});

test('el historial se redacta, se guarda en jsonl y se reconstruye igual al reabrir', async () => {
  const workspace = fs.mkdtempSync(path.join(root, 'ws-'));
  const turn = beginTurn({
    workspace,
    agent: 'opencode',
    from: 'claude',
    prompt: 'usa sk-SECRETSECRET y token=sekreto',
  });
  const sid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const sessions = [session(sid, 'opencode', workspace, turn.id && new Date().toISOString())];
  const started = readStore(workspace).tasks.find((item) => item.id === turn.id);
  sessions[0].createdAt = started.startedAt;
  const log = createTurnLog({
    turnId: turn.id,
    workspace,
    agent: 'opencode',
    author: 'claude',
    prompt: 'usa sk-SECRETSECRET y token=sekreto',
    listSessions: async () => sessions,
  });
  log.tool({ name: 'tool', target: 'README.md', detail: 'Bearer abc.def.ghi', line: '→ read README.md' });
  log.conversation('session', 'oc-session-1');
  await log.finish('listo');

  const raw = fs.readFileSync(turnTranscriptPath(turn.id), 'utf8');
  assert.equal(raw.includes('sk-SECRETSECRET'), false);
  assert.equal(raw.includes('sekreto'), false);
  assert.equal(raw.includes('abc.def.ghi'), false);
  assert.equal(raw.includes('[redactado]'), true);
  for (const line of raw.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    assert.equal(typeof event.id, 'string');
    assert.equal(typeof event.at, 'string');
    assert.equal(event.turnId, turn.id);
    assert.ok(['user', 'tool', 'agent', 'status'].includes(event.kind));
  }

  const tasks = readStore(workspace).tasks.map((item) => ({ ...item, workspace }));
  const linked = tasks.find((item) => item.id === turn.id);
  assert.equal(linked.sessionId, sid);
  assert.equal(linked.conversation.id, 'oc-session-1');
  assert.equal(linked.conversation.kind, 'session');

  const first = readConversation(sid, { tasks, sessions });
  const kinds = first.map((event) => event.kind);
  assert.deepEqual(kinds.filter((kind) => kind !== 'status'), ['user', 'tool', 'agent']);
  assert.equal(first[0].author, 'claude');
  assert.equal(first.find((event) => event.kind === 'tool').text.includes('README.md'), true);

  const sessionFile = fs.readFileSync(sessionTranscriptPath(sid), 'utf8');
  fs.rmSync(sessionTranscriptPath(sid), { force: true });
  const fromTurns = readConversation(sid, { tasks, sessions });
  assert.deepEqual(fromTurns.map((event) => event.id), first.map((event) => event.id));
  fs.writeFileSync(sessionTranscriptPath(sid), sessionFile);
  const reopened = readConversation(sid, { tasks: [], sessions: [] });
  assert.deepEqual(reopened.map((event) => event.id), first.map((event) => event.id));
});
