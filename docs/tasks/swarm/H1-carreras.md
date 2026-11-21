Tarea H1: corrige las condiciones de carrera existentes en el estado de Silka.

Fuente de verdad: lee `docs/architecture/concurrency.md` (§2 tabla C-01…C-07, §4 invariantes, §5 pruebas) y `docs/adr/0007-estado-en-archivos.md`. Implementa exactamente lo que dicen.

Alcance (solo estos archivos y sus tests):
- `src/silka/lock.mjs`:
  - C-01: romper un lock rancio de forma atómica (rename a un nombre único y verificar el dueño visto).
  - C-02: reemplazo atómico sin borrar el destino antes (en Windows `rename` reemplaza si el destino no está abierto; reintentar, y como último recurso `copyFile`).
  - C-03: el dueño del lock guarda PID **y** hora de inicio del proceso; un PID vivo con otra hora de inicio cuenta como muerto.
- `src/silka/models.mjs` (C-04): read-modify-write de cachés, no disponibles y recientes bajo `withFileLock`.
- `src/silka/interrupt.mjs` y la parte de vigilancia de interrupciones del shim (C-05, C-06):
  - las órdenes se indexan por id de turno (`task.id` de `.silka/tasks.json`), no por PID; el shim solo acepta órdenes con su id;
  - registra un enlace explícito sesión ↔ turno en lugar de la heurística `shimPidForSession`;
  - mantén compatibilidad con quien llama hoy: `commands.mjs`, `bridge.mjs`, `ui.mjs`.
- `src/silka/connect.mjs` (C-07): escritura atómica de configs externas.
- Tests nuevos en `test/concurrency.test.mjs` con `node:test` y procesos hijos reales, sin dependencias nuevas: T-CC-01…T-CC-06 de concurrency.md §5. Agrégalo al script `test` de package.json.

Reglas:
- Trabaja SOLO en este directorio (es un git worktree en la rama `swarm/h1`). No hagas commits, no cambies de rama, no toques `src/silka/bridge.mjs` salvo lo mínimo para el enlace sesión ↔ turno, ni `src/silka/ui/`.
- No apagues ni reinicies el hub del puerto 8987, ni mates procesos node que no hayas lanzado tú.
- `npm test` debe pasar completo y `node --check` en todo lo tocado.

Al terminar responde en 8 líneas o menos: qué corrección hiciste por cada C-0x, archivos y resultado de `npm test`.
