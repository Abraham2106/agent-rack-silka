Tarea F5: implementa contexto por referencia y métricas.

Fuente de verdad: `docs/specs/features/F5-contexto-metricas.md` (requisitos, NFR-TOK, pruebas) y `docs/specs/silka-v1.md` (principios: ahorrar por arquitectura, nunca recortando información). Revisa `src/silka/codemode/token-metrics.mjs` y `output-store.mjs` (F1) y reutilízalos, sin duplicar.

Alcance: módulo `src/silka/context/` y `src/silka/metrics/` según el spec (contexto compartido por referencia con hash y tamaño, entrega bajo demanda; métricas medidas de verdad —tokens reales cuando el agente los reporta, estimación marcada como tal si no— por tarea y por sesión; comando `silka metrics`; conexión en la API de Code Mode si el spec lo pide). Tests `test/context.test.mjs` y `test/metrics.test.mjs` (node:test, sin dependencias nuevas) agregados al script `test` de package.json.

Reglas: trabaja SOLO en este worktree (rama `swarm/f5`), sin commits ni cambio de rama. Ejecuta `npm test` y `node --check` de lo tocado; si algo falla en la terminal, dilo. No toques el hub del puerto 8987. Responde en 8 líneas o menos con el resultado REAL (números de npm test) y lo que no quedó.
