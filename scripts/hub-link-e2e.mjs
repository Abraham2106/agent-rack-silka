// Prueba manual: hub real en un puerto aparte; se mata y se relanza, y el enlace debe reconectar.
//   SILKA_CONFIG=<config con otro puerto> node scripts/hub-link-e2e.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hubStatus, openHubClient } from '../src/silka/hub.mjs';
import { createHubLink } from '../src/silka/hub-link.mjs';
import { signalProcessTree } from '../src/silka/proc.mjs';

const cli = fileURLToPath(new URL('../src/silka/cli.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startHub() {
  const child = spawn(process.execPath, [cli, 'hub'], { stdio: 'ignore', env: process.env });
  for (let i = 0; i < 80; i += 1) { const s = hubStatus(); if (s.alive && s.runtime?.pid !== prevPid) return child; await sleep(250); }
  throw new Error('el hub de prueba no arrancó');
}
let prevPid = null;
const states = [];
let hub = await startHub();
prevPid = hubStatus().runtime.pid;
const link = createHubLink(openHubClient, { onState: (s) => states.push(s.ok ? 'ok' : `caído: ${s.error}`) });
console.log('1ª llamada:', Array.isArray(await link.listSessions()) ? 'ok' : 'rara');
signalProcessTree(hub.pid, { force: true });
await sleep(1500);
hub = await startHub();
await sleep(1500);
try {
  console.log('tras reinicio:', Array.isArray(await link.listSessions()) ? 'ok (reconectó)' : 'rara');
} catch (err) {
  console.log('tras reinicio: FALLÓ', err.message);
}
console.log('estados:', states.join(' | '));
await link.close();
signalProcessTree(hub.pid, { force: true });
process.exit(0);
