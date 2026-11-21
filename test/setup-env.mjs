// Se carga en cada proceso de prueba (node --test --import): ninguna prueba escribe en la
// configuración real del usuario (~/.config/silka). Antes, los repos temporales de las
// pruebas terminaban en el registro real y el supervisor del hub recorría cientos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.SILKA_CONFIG_DIR) {
  process.env.SILKA_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silka-test-config-'));
}
