import fs from 'node:fs';
import { metricsFile } from './record.mjs';

export function readMetrics(workspace) {
  const file = metricsFile(workspace);
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row && typeof row === 'object' ? [row] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}