// Actualiza el estado de filas de docs/architecture/traceability.md y del checkpoint en README.
//   node scripts/trace-set.mjs "<prefijo de fila>=<estado>" ... [--checkpoint "<ID>=<estado>"]
// Cambia solo la última columna (estado) de la primera fila que empieza con "| <prefijo>".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracePath = path.join(root, 'docs/architecture/traceability.md');
const readmePath = path.join(root, 'docs/architecture/README.md');

function setLast(lines, prefix, status) {
  const i = lines.findIndex((l) => l.startsWith(`| ${prefix}`));
  if (i < 0) { console.error(`no encontré la fila: ${prefix}`); return false; }
  const cells = lines[i].split('|');
  cells[cells.length - 2] = ` ${status} `;
  lines[i] = cells.join('|');
  return true;
}

const args = process.argv.slice(2);
const trace = fs.readFileSync(tracePath, 'utf8').split('\n');
const readme = fs.readFileSync(readmePath, 'utf8').split('\n');
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--checkpoint') {
    const [id, status] = args[++i].split('=');
    // En README la penúltima columna es el estado y la última el commit.
    const j = readme.findIndex((l) => l.startsWith(`| ${id} |`));
    if (j < 0) { console.error(`no encontré el checkpoint ${id}`); continue; }
    const cells = readme[j].split('|');
    cells[cells.length - 3] = ` ${status} `;
    cells[cells.length - 2] = ` ver git log "feat(${id})" `;
    readme[j] = cells.join('|');
    continue;
  }
  const eq = args[i].lastIndexOf('=');
  setLast(trace, args[i].slice(0, eq), args[i].slice(eq + 1));
}
fs.writeFileSync(tracePath, trace.join('\n'));
fs.writeFileSync(readmePath, readme.join('\n'));
console.log('ok');
