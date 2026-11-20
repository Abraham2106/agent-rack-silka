import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const notesUrl = pathToFileURL(path.resolve('src/silka/notes.mjs')).href;

function run(code, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, SILKA_CONFIG_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `exit ${code}`));
    });
  });
}

test('dos procesos no se pisan las notas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-notes-'));
  const write = `
    import { appendNote } from ${JSON.stringify(notesUrl)};
    for (let i = 0; i < 40; i++) appendNote({ sessionId: 's', text: 'n' + i });
  `;
  const read = `
    import { unreadNotes } from ${JSON.stringify(notesUrl)};
    for (let i = 0; i < 20; i++) unreadNotes({ markRead: true });
  `;
  await Promise.all([run(write, dir), run(read, dir)]);
  const body = fs.readFileSync(path.join(dir, 'notes.jsonl'), 'utf8').trim().split(/\n/).filter(Boolean);
  assert.equal(body.length, 40);
  const ids = new Set(body.map((line) => JSON.parse(line).id));
  assert.equal(ids.size, 40);
});
