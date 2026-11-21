Tarea F3: implementa la bandeja de revisión.

Fuente de verdad: `docs/specs/features/F3-bandeja-revision.md` (FR-RV-01…08, SEC-08/09, NFR-UX, pruebas de aceptación) y `docs/architecture/concurrency.md`. Usa lo que ya existe en `src/silka/tasks/` (manager, store, card, states, risk) y la API de Code Mode en `src/silka/codemode/` (api-schema, api-dispatch: hoy `silka.review.*` responde E_NOT_IMPLEMENTED).

Alcance: módulo `src/silka/review/` (inbox ordenada por riesgo y antigüedad; approve/reject/discard idempotentes con versión y `E_STALE`; reject reanuda la misma sesión con la nota; approve deja la tarea lista para la cola de F4 sin mezclar; auditoría `.silka/reviews.jsonl`; política de aprobación §3; escape ANSI/OSC del texto del agente), conexión en la API de Code Mode, comandos CLI `silka review ls|approve|reject|discard`, y la vista `r` del TUI solo si cabe sin tocar mucho (si no, deja la lógica lista y dilo). Tests `test/review.test.mjs` (node:test, sin dependencias nuevas) agregados al script `test` de package.json.

Reglas: trabaja SOLO en este worktree (rama `swarm/f3`), sin commits ni cambio de rama. Ejecuta `npm test` y `node --check` de lo tocado; si algo falla en la terminal, dilo. No toques el hub del puerto 8987. Responde en 8 líneas o menos con el resultado REAL (números de npm test) y lo que no quedó.
