# Proposal

## Why

Las notas de Silka viven en un único archivo que llegó a 139 KB y 593 notas; casi todas eran avisos de conflicto
repetidos en cada ciclo. Un agente que llamó a `silka_notes` recibió ~130 mil caracteres de ruido de una vez.

## What Changes

- Un archivo de notas por sesión (`<config>/notes/<sesión>.jsonl`) en lugar de uno global.
- `silka_notes` con sesión devuelve solo esa sesión, paginado (por defecto las últimas 20 y un resumen del
  resto). Sin sesión devuelve solo conteos por sesión, nunca contenido.
- Las notas son volátiles: se borran cuando la sesión terminó y sus notas se leyeron, o cuando su tarea se cerró;
  si la sesión desapareció (hub reiniciado), a las 24 h.
- Los conflictos dejan de escribirse como notas: pasan a ser estado de la tarea (una entrada por par de tareas y
  archivo, que se marca resuelta).
- El archivo global actual se migra y el ruido se descarta.

**Fuera de alcance:** mensajería entre agentes y reservas de archivos (lo evaluará la prueba de MCP Agent Mail de
la fase 2 del plan de estabilización); si esa prueba sale bien, este cambio puede reemplazarse por esa
integración.

## Capabilities

### New Capabilities

- `session-notes`: notas por sesión, paginadas y volátiles, y conflictos como estado de la tarea.

### Modified Capabilities

(ninguna)

## Impact

- `src/silka/notes.mjs`, `src/silka/state.mjs` (detector de conflictos), `src/silka/bridge.mjs` (`silka_notes`),
  el TUI (marca ✉ y ⚠) y la cola de despacho (avisos de entrega fallida).
- Migración única del archivo de notas actual.
