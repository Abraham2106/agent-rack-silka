export const DEFAULT_WALL_SECONDS = 60;
export const MAX_WALL_SECONDS = 60 * 60;
export const HEAP_MB = 128;
export const MAX_IPC_CALLS = 200;
export const MAX_IPC_MESSAGE_BYTES = 1024 * 1024;
export const SEARCH_MAX_BYTES = 4 * 1024;
export const OUTPUT_INLINE_MAX_BYTES = 8 * 1024;
export const OUTPUT_PREVIEW_CHARS = 512;

export function wallMs(timeoutSeconds) {
  const base = Number(timeoutSeconds);
  const seconds = Number.isFinite(base) && base > 0 ? base : DEFAULT_WALL_SECONDS;
  return Math.min(seconds, MAX_WALL_SECONDS) * 1000;
}