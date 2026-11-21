import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-send-'));
process.env.SILKA_CONFIG_DIR = root;

const { canSilkaSend, performSilkaSend } = await import('../src/silka/bridge.mjs');
const { sendToSession, steerSession } = await import('../src/silka/commands.mjs');
const { dispatchOnce } = await import('../src/silka/dispatch.mjs');
const {
  TOOL_WAIT_MS,
  clearInterrupt,
  createToolGate,
  cursorToolPhase,
  readInterrupt,
} = await import('../src/silka/interrupt.mjs');
const { chordAction, translateInputChunk } = await import('../src/silka/keys.mjs');
const { recentInsertions } = await import('../src/silka/notes.mjs');
const { PRIORITY_LEAD, PRIORITY_TAIL, listQueue } = await import('../src/silka/queue.mjs');
const { formatBlock } = await import('../src/silka/state.mjs');
const { frameLayout, uiRenderOptions } = await import('../src/silka/ui.mjs');
const { waitOutTool } = await import('../shims/agent-shim.mjs');

const sessionId = '11111111-1111-1111-1111-111111111111';

let tail = Promise.resolve();
function exclusive(body) {
  const run = tail.then(body);
  tail = run.then(() => {}, () => {});
  return run;
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-send-ws-'));
  const task = {
    id: 'turn-1',
    agent: 'codex',
    status: 'running',
    pid: process.pid,
    sessionId,
    workspace: dir,
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(dir, '.silka'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.silka', 'tasks.json'), JSON.stringify({ tasks: [task], conflicts: [] }));
  return dir;
}

function session(dir, extra = {}) {
  return {
    sessionId,
    status: 'running',
    agentId: 'codex',
    workspace: dir,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

test('la orden de interrupción, la entrega única y el alias steer', () => exclusive(async () => {
  clearInterrupt('turn-1');
  const dir = workspace();
  const running = session(dir);
  sendToSession(running, { text: 'lo de la cola', author: 'tú', now: false });
  const sent = sendToSession(running, { text: 'hazlo ya', author: 'tú', now: true });
  assert.equal(sent.interrupted, true);
  assert.equal(sent.item.now, true);
  const order = readInterrupt('turn-1');
  assert.equal(order.sessionId, sessionId);
  assert.equal(order.turnId, 'turn-1');
  assert.equal(order.text, 'hazlo ya');

  const notes = recentInsertions(dir);
  assert.equal(notes.length >= 2, true);
  assert.match(notes.map((note) => note.text).join('\n'), /tú → codex/);
  assert.match(formatBlock(dir), /tú → codex/);

  const seen = [];
  const client = {
    turn: 1,
    async listSessions() {
      return [{ sessionId, status: 'completed', turnCount: client.turn, agentId: 'codex' }];
    },
    async sendInput(_id, text) {
      seen.push(text);
      client.turn += 1;
    },
  };
  assert.equal(await dispatchOnce(client), 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0], new RegExp(PRIORITY_LEAD.replace(/[()]/g, '\\$&')));
  assert.match(seen[0], /hazlo ya/);
  assert.match(seen[0], /lo de la cola/);
  assert.match(seen[0], new RegExp(PRIORITY_TAIL.replace(/[()]/g, '\\$&')));
  assert.equal(listQueue(sessionId).length, 0);
  assert.equal(await dispatchOnce(client), 0);
  assert.equal(seen.length, 1);

  const idleId = '22222222-2222-2222-2222-222222222222';
  const idle = sendToSession(
    { ...running, sessionId: idleId, status: 'completed' },
    { text: 'turno normal', author: 'tú', now: true },
  );
  assert.equal(idle.interrupted, false);
  assert.equal(idle.item.now, false);
  assert.match(formatBlock(dir), /turno normal/);

  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await steerSession({
      async listSessions() { return [running]; },
    }, {}, [sessionId.slice(0, 8), 'desde steer']);
  } finally {
    console.log = log;
  }
  assert.match(lines.join('\n'), /enviado ya/);
  const again = readInterrupt('turn-1');
  assert.equal(again.text, 'desde steer');
  clearInterrupt('turn-1');
}));

test('silka_send con y sin now, y un sub-agente no toca sesiones ajenas', () => exclusive(() => {
  clearInterrupt('turn-1');
  const dir = workspace();
  const running = session(dir);
  const quiet = performSilkaSend({
    from: 'claude',
    manager: true,
    session: { ...running, status: 'completed', sessionId: '33333333-3333-3333-3333-333333333333' },
    origins: {},
    text: 'encola',
    now: false,
  });
  assert.equal(quiet.interrupted, false);
  assert.equal(quiet.item.author, 'claude');
  assert.equal(quiet.item.now, false);

  const now = performSilkaSend({
    from: 'claude-code',
    manager: true,
    session: running,
    origins: {},
    text: 'corrige',
    now: true,
  });
  assert.equal(now.interrupted, true);
  assert.equal(now.item.author, 'claude');
  assert.equal(now.item.now, true);
  assert.equal(readInterrupt('turn-1').author, 'claude');

  const foreign = { ...running, sessionId: '44444444-4444-4444-4444-444444444444', agentId: 'codex' };
  assert.equal(canSilkaSend({
    from: 'opencode',
    manager: false,
    session: foreign,
    origins: { [foreign.sessionId]: { from: 'claude' } },
  }), false);
  assert.throws(() => performSilkaSend({
    from: 'opencode',
    manager: false,
    session: foreign,
    origins: { [foreign.sessionId]: { from: 'claude' } },
    text: 'no debes',
    now: true,
  }), /sesiones ajenas/);

  const ownId = '55555555-5555-5555-5555-555555555555';
  const own = performSilkaSend({
    from: 'opencode',
    manager: false,
    session: { ...running, sessionId: ownId, agentId: 'opencode', status: 'completed' },
    origins: { [ownId]: { from: 'opencode' } },
    text: 'la mía',
    now: false,
  });
  assert.equal(own.item.author, 'opencode');
  clearInterrupt('turn-1');
}));

test('el shim espera a que termine la herramienta y respeta el tope', async () => {
  assert.equal(TOOL_WAIT_MS, 5_000);
  // Una lectura no bloquea la interrupción; una edición sí.
  const reads = createToolGate();
  reads.observe(cursorToolPhase({ type: 'tool_call', subtype: 'started', call_id: 'r', tool_call: { readToolCall: {} } }));
  assert.equal(reads.busy(), false);
  const edits = createToolGate();
  edits.observe(cursorToolPhase({ type: 'tool_call', subtype: 'started', call_id: 'e', tool_call: { editToolCall: {} } }));
  assert.equal(edits.busy(), true);
  const gate = createToolGate();
  gate.observe(cursorToolPhase({ type: 'tool_call', subtype: 'started', call_id: 'a' }));
  const started = Date.now();
  const pending = waitOutTool(gate, 300);
  setTimeout(() => {
    gate.observe(cursorToolPhase({ type: 'tool_call', subtype: 'completed', call_id: 'a' }));
  }, 30);
  assert.equal(await pending, 'idle');
  assert.ok(Date.now() - started < 250);

  const stuck = createToolGate();
  stuck.observe(cursorToolPhase({ type: 'tool_call', subtype: 'started', call_id: 'b' }));
  const t0 = Date.now();
  assert.equal(await waitOutTool(stuck, 40), 'timeout');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 30 && elapsed < 250);
});

test('parsea Ctrl+Enter y Alt+Enter', () => {
  assert.equal(chordAction('\u001b[13;5u'), 'now');
  assert.equal(chordAction('\u001b[13;3u'), 'now');
  assert.equal(chordAction('\u001b[27;5;13~'), 'now');
  assert.equal(chordAction('\u001b[27;3;13~'), 'now');
  assert.equal(chordAction('\u001b\r'), 'now');
  assert.equal(chordAction('\r'), 'queue');
  assert.equal(translateInputChunk('\u001b[27;5;13~').out, '\u001b[13;5u');
  assert.equal(translateInputChunk('\u001b[<64;1;1M').out, '\u001b[5~');
  assert.equal(translateInputChunk('\u001b[<65;2;3M').out, '\u001b[6~');
  assert.equal(translateInputChunk('\u001b[?1u').out, '\u001b[?1u');
  for (let rows = 1; rows <= 40; rows += 1) {
    const frame = frameLayout(rows, { composerInner: rows > 12 ? 6 : 2 });
    const used = frame.header + frame.body + frame.composer + frame.banner + frame.footer;
    assert.equal(used, rows);
    assert.ok(frame.body >= 0);
  }
  assert.equal(uiRenderOptions({}).alternateScreen, true);
  assert.equal(uiRenderOptions({ SILKA_NO_FULLSCREEN: '1' }).alternateScreen, false);
  assert.equal(uiRenderOptions({}).maxFps, 10);
});

test('Esc solo se suelta tras una pausa corta (no queda retenido)', async () => {
  const { installInputFix } = await import('../src/silka/keys.mjs');
  const { EventEmitter } = await import('node:events');
  const stdin = new EventEmitter();
  const chunks = ['\u001b'];
  stdin.read = () => (chunks.length ? chunks.shift() : null);
  const restore = installInputFix(stdin);
  assert.equal(stdin.read(), null); // retenido: podría empezar una secuencia
  const released = await new Promise((resolve) => {
    stdin.once('readable', () => resolve(stdin.read()));
    setTimeout(() => resolve('timeout'), 500);
  });
  assert.equal(released, '\u001b');
  restore();
});
