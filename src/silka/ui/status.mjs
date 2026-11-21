import { clip } from '../format.mjs';

export function estadoLines(board) {
  const lines = [];
  if (!board) {
    lines.push('Sin workspace seleccionado.');
    return lines;
  }
  lines.push(board.repo
    ? `${board.repo.branch}  @  ${board.repo.head ? board.repo.head.slice(0, 7) : 'sin commits'}`
    : 'sin repo git');
  if (board.graph) lines.push(board.graph);
  const conflicts = (board.conflicts || []).filter((conflict) => Date.now() - Date.parse(conflict.at) < 6 * 60 * 60 * 1000);
  lines.push(conflicts.length ? 'Conflictos' : 'Conflictos  ninguno');
  for (const conflict of conflicts.slice(0, 4)) lines.push(`! ${conflict.file}`);
  lines.push('Tareas');
  const tasks = [...(board.tasks || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 8);
  if (!tasks.length) lines.push('sin tareas registradas');
  for (const task of tasks) {
    const files = [...(task.files || []), ...(task.ambiguous || []).map((file) => `${file}?`)]
      .filter((file) => !file.startsWith('.silka/') && !file.startsWith('.git/') && !file.startsWith('graphify-out/'))
      .slice(0, 4)
      .join(', ');
    lines.push(`${task.status === 'running' ? '▶' : '●'} ${task.agent} ${task.from || ''} ${files || 'sin archivos'}`);
    if (task.summary) lines.push(`  ${task.summary}`);
  }
  lines.push('Decisiones');
  if (!board.decisions?.length) lines.push('sin decisiones');
  for (const decision of (board.decisions || []).slice(0, 3)) lines.push(`${decision.author}: ${decision.text}`);
  return lines;
}

export function renderEstado(h, Box, Text, { height, columns, board }) {
  const lines = estadoLines(board).slice(0, Math.max(1, height - 3));
  return h(
    Box,
    { flexGrow: 1, height, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
    h(Text, { bold: true }, 'Estado'),
    ...lines.map((line, index) => h(
      Text,
      { key: `estado-${index}`, color: line.startsWith('!') ? 'red' : undefined, dimColor: line.startsWith('  '), wrap: 'truncate' },
      clip(line, columns - 4),
    )),
  );
}
