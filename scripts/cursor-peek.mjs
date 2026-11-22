// Sigue en vivo lo que hace un agente de Cursor CLI leyendo su chat local (solo lectura).
//   node scripts/cursor-peek.mjs [chatId]
// Sin chatId toma el chat de Cursor modificado más recientemente.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = path.join(os.homedir(), '.cursor', 'chats');
function latestChat(wanted) {
  let best;
  for (const ws of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    for (const id of fs.readdirSync(path.join(base, ws))) {
      const dir = path.join(base, ws, id);
      const db = path.join(dir, 'store.db');
      if (!fs.existsSync(db)) continue;
      if (wanted && id !== wanted) continue;
      const m = Math.max(fs.statSync(db).mtimeMs, fs.existsSync(db + '-wal') ? fs.statSync(db + '-wal').mtimeMs : 0);
      if (!best || m > best.m) best = { dir, db, id, m };
    }
  }
  return best;
}

const chat = latestChat(process.argv[2]);
if (!chat) { console.error('No encontré chats de Cursor en ' + base); process.exit(1); }
let cwd = '';
try { cwd = JSON.parse(fs.readFileSync(path.join(chat.dir, 'meta.json'), 'utf8')).cwd ?? ''; } catch { /* sin meta */ }
console.log(`\x1b[35mcursor\x1b[0m chat ${chat.id.slice(0, 8)}  ${cwd}\n`);

const short = (p) => (typeof p === 'string' && cwd && p.startsWith(cwd) ? p.slice(cwd.length + 1) : p);
function describe(call) {
  const a = call.args ?? call.input ?? {};
  const target = short(a.path ?? a.file_path ?? a.target_file ?? a.command ?? a.pattern ?? a.query ?? '');
  return `${call.toolName ?? call.name}  ${String(target).replace(/\s+/g, ' ').slice(0, 110)}`;
}

let last = 0;
function tick() {
  let db;
  try { db = new DatabaseSync(chat.db, { readOnly: true }); } catch { return; }
  try {
    for (const r of db.prepare('select rowid, data from blobs where rowid > ? order by rowid').all(last)) {
      last = r.rowid;
      const s = Buffer.from(r.data).toString('utf8');
      if (!s.trimStart().startsWith('{')) continue;
      let j; try { j = JSON.parse(s); } catch { continue; }
      const time = new Date().toLocaleTimeString();
      const parts = Array.isArray(j.content) ? j.content : [{ type: 'text', text: j.content }];
      for (const p of parts) {
        if (j.role === 'assistant' && p.type === 'tool-call') console.log(`\x1b[2m${time}\x1b[0m \x1b[36m→\x1b[0m ${describe(p)}`);
        else if (j.role === 'assistant' && p.type === 'text' && p.text?.trim()) console.log(`\x1b[2m${time}\x1b[0m \x1b[33m✎\x1b[0m ${p.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`);
        else if (j.role === 'user' && typeof p.text === 'string' && last < 10) console.log(`\x1b[2m${time}\x1b[0m \x1b[35mprompt\x1b[0m ${p.text.trim().split('\n')[0].slice(0, 120)}…`);
      }
    }
  } finally { db.close(); }
}
tick();
setInterval(tick, 1500);
