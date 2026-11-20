import os from 'node:os';
import path from 'node:path';

/** Config de Silka. Los tests pueden apuntar a un directorio temporal con SILKA_CONFIG_DIR. */
export function silkaConfigDir() {
  return process.env.SILKA_CONFIG_DIR || path.join(os.homedir(), '.config', 'silka');
}
