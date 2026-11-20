export function shortId(sessionId) {
  return String(sessionId ?? '').slice(0, 8);
}

export function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

export function promptPreview(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export function clip(text, width) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (width <= 0) return '';
  if (clean.length <= width) return clean;
  if (width === 1) return '…';
  return `${clean.slice(0, width - 1)}…`;
}

export function isBusy(status) {
  return status === 'running' || status === 'cancelling';
}

export function formatDuration(session, now = Date.now()) {
  const start = Date.parse(session?.createdAt);
  if (!Number.isFinite(start)) return '—';
  const finished = Date.parse(session?.finishedAt);
  const end = !isBusy(session?.status) && Number.isFinite(finished) ? finished : now;
  let seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function formatEvent(event) {
  const lines = activityFromEvent(event);
  if (lines.length) return lines.join(' ');
  const label = event?.toolName ? `${event.type}:${event.toolName}` : (event?.type || 'log');
  return `[${label}]`;
}

function oneLine(value, max = 88) {
  return clip(String(value ?? '').replace(/\s+/g, ' ').trim(), max);
}

function commandText(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') return input.command || input.cmd || '';
  return '';
}

function fileText(input) {
  if (!input || typeof input !== 'object') return '';
  return input.path || input.filePath || input.file_path || input.target_file || input.file || '';
}

function verbFor(name) {
  const low = String(name || '').toLowerCase();
  if (/shell|bash|command/.test(low)) return '$';
  if (/edit|patch|strreplace|apply/.test(low)) return 'edit';
  if (/write|create/.test(low)) return 'write';
  if (/delete|remove/.test(low)) return 'delete';
  if (/read|view|cat/.test(low)) return 'read';
  return low || 'tool';
}

function linesFromItem(item) {
  if (!item || typeof item !== 'object') return [];
  if (item.type === 'file_change' && Array.isArray(item.changes)) {
    return item.changes.map((change) => {
      const kind = change?.kind === 'delete' ? 'delete' : change?.kind === 'add' ? 'write' : 'edit';
      const file = change?.path || change?.file || '';
      return file ? `→ ${kind} ${file}` : '';
    }).filter(Boolean);
  }
  if (item.type === 'command_execution' && item.command) return [`→ $ ${oneLine(item.command)}`];
  if (item.type === 'agent_message' && item.text) return [`✎ ${oneLine(item.text, 80)}`];
  if (item.type === 'web_search') return [`→ search ${oneLine(item.query || '', 70)}`];
  if (item.type === 'reasoning') return [];
  return [];
}

/** Una línea corta por paso. El JSON crudo de Codex no se muestra. */
export function activityFromEvent(event) {
  if (!event || typeof event !== 'object') return [];
  if (event.type === 'status') {
    return String(event.content ?? '').split(/\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      if (line.startsWith('→') || line.startsWith('✎') || line.startsWith('✗')) return [oneLine(line, 120)];
      if (line.startsWith('{') || line.startsWith('[')) return [];
      return [oneLine(line, 100)];
    });
  }
  if (event.type === 'tool_call') {
    const command = commandText(event.input);
    const file = fileText(event.input);
    const name = event.toolName || '';
    if (command || verbFor(name) === '$') return command ? [`→ $ ${oneLine(command)}`] : [];
    if (file) return [`→ ${verbFor(name)} ${oneLine(file)}`];
    if (name && name !== 'unknown_tool') return [`→ ${name}`];
    return [];
  }
  if (event.type === 'tool_result') return [];
  if (event.type === 'error') {
    const text = oneLine(event.content, 80);
    return text ? [`✗ ${text}`] : [];
  }
  if (event.type === 'text') {
    const raw = String(event.content ?? '').trim();
    if (!raw) return [];
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { return linesFromItem(JSON.parse(raw)); } catch { return []; }
    }
    if (raw.startsWith('→') || raw.startsWith('✎') || raw.startsWith('✗')) return [oneLine(raw, 120)];
    return [`✎ ${oneLine(raw, 80)}`];
  }
  return [];
}

export function activityFromEvents(events) {
  const lines = [];
  for (const event of events || []) {
    for (const line of activityFromEvent(event)) {
      if (line && line !== lines.at(-1)) lines.push(line);
    }
  }
  return lines;
}

export function statusColor(status) {
  if (status === 'running' || status === 'cancelling') return 'yellow';
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  return 'gray';
}

export function statusIcon(status) {
  if (status === 'running') return '▶';
  if (status === 'cancelling') return '◐';
  if (status === 'completed') return '●';
  if (status === 'failed') return '✗';
  if (status === 'cancelled') return '○';
  return '·';
}
