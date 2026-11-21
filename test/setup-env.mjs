// Se carga en cada proceso de prueba (node --test --import): ninguna prueba escribe en la
// configuración real del usuario (~/.config/silka). Antes, los repos temporales de las
// pruebas terminaban en el registro real y el supervisor del hub recorría cientos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.SILKA_CONFIG_DIR) {
  process.env.SILKA_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-test-config-'));
}
if (!process.env.SILKA_DATA_DIR) {
  // Los worktrees viven fuera del repo (BUG-06); en pruebas, en un temporal propio.
  process.env.SILKA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-test-data-'));
}
