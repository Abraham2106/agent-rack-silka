Tarea F2: implementa las tareas aisladas, la verificación por Silka y las fichas de entrega.

Fuente de verdad: lee `docs/specs/features/F2-tareas-aisladas.md` (modelo de tarea, máquina de estados, FR-TK-01…10, SEC-06…08, pruebas T-TK-01…05), `docs/adr/0005-worktree-por-tarea.md` y `docs/architecture/concurrency.md` (D-06, D-07, D-08). Implementa exactamente eso.

Alcance:
- Módulo nuevo `src/silka/tasks/`:
  - modelo y validación de tarea (FR-TK-02);
  - gestor con la máquina de estados, donde **el hub es el escritor único** y cada transición se registra;
  - `git worktree` y rama `silka/<id>` desde el commit base (FR-TK-01);
  - dependencias (FR-TK-03), tope de simultaneidad (FR-TK-08), puertos bajo lock (FR-TK-09);
  - ejecución de `verify` en el worktree con tiempo límite y log por referencia (FR-TK-04);
  - ficha con archivos y diff calculados con git, no con lo que diga el agente (FR-TK-05);
  - riesgo (FR-TK-06, FR-TK-10);
  - vida del worktree (FR-TK-07).
- **Git siempre** con `-c core.hooksPath=<directorio vacío>` (SEC-06), con un helper único para todos los comandos git.
- Estado de tareas en `<repo>/.silka/tasks-v1/` usando `withFileLock` y `writeAtomic` de `src/silka/lock.mjs`, ya corregidos en H1.
- Conecta la API de Code Mode, que hoy responde `E_NOT_IMPLEMENTED`: `silka.plan.fromFile` / `fromList`, `silka.launch(plan)` con aislamiento por worktree, y `silka.card(id)`. Ver `src/silka/codemode/`.
- CLI: `silka task run <archivo-plan>` y `silka task ls`.
- Tests `test/tasks.test.mjs` (`node:test`, sin dependencias nuevas, con un repo git temporal y un agente falso que escribe archivos): T-TK-01…05, transiciones inválidas rechazadas y riesgo por archivos sensibles. Agrégalo al script `test`.

Reglas:
- Trabaja SOLO en este directorio (git worktree de la rama `swarm/f2`). No hagas commits ni cambies de rama.
- **Ejecuta las pruebas**: `npm test` debe pasar completo y `node --check` en todo lo que toques. Si la terminal falla, dilo explícitamente en tu respuesta.
- No apagues ni reinicies el hub del puerto 8987. Si necesitas un hub, usa una config temporal con otro puerto y apágalo al terminar.
- No dejes procesos vivos tuyos al terminar.

Al terminar responde en 10 líneas o menos: archivos, resultado REAL de `npm test` (números), qué prueba cubre cada SEC y qué no quedó.
