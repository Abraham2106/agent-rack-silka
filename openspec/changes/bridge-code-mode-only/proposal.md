# Proposal

## Why

El bridge MCP de Silka expone hoy 22 herramientas al manager (las de agent-rack más las propias de Silka). Code
Mode existe justamente para no cargarlas todas: con `silka_search` y `silka_execute` el manager descubre la API
por partes y hace en una llamada lo que antes eran muchas. Exponer las 22 anula ese ahorro en cada sesión y,
además, deja a mano herramientas que un agente puede usar para salirse de su tarea (por ejemplo, crear sesiones de
agente).

## What Changes

- **BREAKING:** por defecto el bridge expone solo `silka_search` y `silka_execute`. Todo lo demás (crear y listar
  sesiones, enviar, notas, estado, revisión, mezcla) se usa a través de la API de Code Mode (`silka.*`).
- Modo de compatibilidad explícito (`SILKA_BRIDGE_TOOLS=all` o la opción del bridge) para clientes que todavía
  necesitan las herramientas clásicas; queda documentado como transitorio.
- La API de Code Mode cubre todo lo que hoy hacen las herramientas clásicas, para que el modo mínimo no pierda
  funciones.
- Se mide el efecto con `/context` y con `claude plugin details` antes y después.

**Fuera de alcance:** cambiar las herramientas de agent-rack en sí; los agentes delegados (su acceso lo limita el
cambio `agent-containment`).

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `code-mode`: el bridge expone por defecto solo Code Mode, con un modo de compatibilidad explícito, y la API
  cubre todas las operaciones de las herramientas clásicas.

## Impact

- `src/silka/bridge.mjs` (lista de herramientas), `src/silka/codemode/` (API y `silka.d.ts`) y
  `silka connect` (registro en los harnesses).
- Documentación de uso y skill `delegar`, que hoy menciona herramientas clásicas (`codex_run`, `cursor_run`…).
- Clientes que llaman herramientas clásicas por nombre deben activar el modo de compatibilidad o migrar.
