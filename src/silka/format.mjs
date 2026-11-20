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
  const label = event?.toolName ? `${event.type}:${event.toolName}` : (event?.type || 'log');
  const text = String(event?.content ?? '').replace(/\s+/g, ' ').trim();
  return text ? `[${label}] ${text}` : `[${label}]`;
}

export function statusColor(status) {
  if (status === 'running' || status === 'cancelling') return 'yellow';
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  return 'gray';
}
