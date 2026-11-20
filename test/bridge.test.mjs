import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertWorkspace, visibleToolNames } from '../src/silka/bridge.mjs';

const NAMES = [
  'opencode_run',
  'agent_session_create',
  'agent_session_send',
  'agent_session_cancel',
  'agent_session_logs',
  'silka_notes',
  'silka_state',
  'silka_decide',
  'silka_changes',
  'silka_decisions',
];

test('a profundidad máxima solo quedan lecturas de silka', () => {
  const blocked = visibleToolNames(NAMES, { depth: 2, max: 2, manager: false });
  assert.deepEqual(blocked.sort(), ['silka_changes', 'silka_decisions', 'silka_state']);
  assert.equal(blocked.includes('agent_session_send'), false);
  assert.equal(blocked.includes('opencode_run'), false);

  const child = visibleToolNames(NAMES, { depth: 1, max: 2, manager: false });
  assert.equal(child.includes('silka_notes'), false);
  assert.equal(child.includes('opencode_run'), true);
  assert.equal(visibleToolNames(NAMES, { depth: 0, max: 2, manager: true }).includes('silka_notes'), true);
});

test('el workspace tiene que ser canónico y estar permitido', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-ws-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const canonical = assertWorkspace(proj, [root]);
  assert.equal(canonical, fs.realpathSync(proj));
  assert.throws(() => assertWorkspace(`${proj}${path.sep}..${path.sep}..`, [root]));
  assert.throws(() => assertWorkspace(`${root}${path.sep}proj${path.sep}..${path.sep}proj`, [root]));
  assert.throws(() => assertWorkspace(os.tmpdir(), [root]));
});
