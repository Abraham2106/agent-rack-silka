Tarea F1: implementa Code Mode (`silka_search` y `silka_execute`) en el bridge de Silka.

Fuente de verdad: lee `docs/specs/features/F1-code-mode.md` (requisitos FR-CM-01…09, SEC-01…05, pruebas), `docs/adr/0003-code-mode.md`, `docs/adr/0004-sandbox-node-permission.md` y `docs/specs/silka-v1.md` §3.1 (superficie de la API). Implementa exactamente eso.

Alcance:
- Módulo nuevo `src/silka/codemode/` con:
  - `silka.d.ts` (la API tipada, versionada con semver);
  - la búsqueda de firmas para `silka_search`;
  - el runner del sandbox (proceso hijo `node --permission` sin `--allow-*`, más un hook de resolución que deniega `net`, `http`, `https`, `http2`, `tls`, `dgram`, `dns`, `child_process`, `worker_threads`, `cluster`, `vm`, `inspector` y `module`, y elimina `fetch`, `WebSocket`, `EventSource` y `process.binding`);
  - el canal IPC con validación de argumentos;
  - el almacén de salidas por referencia (`out:<id>`, sin truncar).
- En `src/silka/bridge.mjs`: añade las dos herramientas. Las herramientas actuales siguen igual (FR-CM-07). Cada llamada de la API pasa por la política existente del bridge (workspaces, profundidad, lista blanca).
- API v1 mapeada a lo que ya existe en el hub: `launch`, `wait`, `waitAll`, `status`, `get`, `send`, `cancel`, `state.*` y `agents.list` / `models`. Lo de F2–F5 que aún no existe (`card`, `review.*`, `merge.*`, `agents.stats`) va en la API pero responde `E_NOT_IMPLEMENTED` con un mensaje claro.
- Límites: SEC-03 (tiempo, heap, llamadas IPC, tamaño). Las esperas largas se resuelven en el hub, no en el sandbox (FR-CM-06).
- Tests en `test/codemode.test.mjs` (`node:test`, sin dependencias nuevas); agrégalo al script `test`:
  - T-SEC-01…07: cada vía de escape falla con su error tipado;
  - T-CM-03: salida grande → referencia, y `get` la devuelve idéntica;
  - una ejecución simple contra un hub falso (stub) que lanza 2 tareas y devuelve un resumen.
- Mide e informa NFR-TOK-01 de forma aproximada: tamaño en tokens (caracteres / 4) de las definiciones de herramientas actuales frente a las 2 nuevas, y de un lote simulado de 5 tareas por herramientas MCP frente a una llamada `silka_execute`.

Reglas:
- Trabaja SOLO en este directorio (es un git worktree en la rama `swarm/f1`). No hagas commits ni cambies de rama.
- No toques `src/silka/lock.mjs`, `interrupt.mjs`, `models.mjs` ni `connect.mjs` (los trabaja otro agente).
- No apagues ni reinicies el hub del puerto 8987, ni mates procesos node que no hayas lanzado tú.
- `npm test` y `node --check` deben pasar.

Al terminar responde en 10 líneas o menos: archivos, qué prueba cubre cada control SEC, la medición aproximada de tokens y qué quedó como `E_NOT_IMPLEMENTED`.
