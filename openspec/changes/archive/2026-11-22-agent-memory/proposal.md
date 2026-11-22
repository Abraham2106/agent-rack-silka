# Proposal

## Why

Silka olvida entre sesiones lo que se decidió y lo que se aprendió: por qué se descartó una opción, qué falló
antes, qué prefiere el usuario. Cada agente nuevo vuelve a cometer los mismos errores (por ejemplo, borrar un
worktree sin soltar el enlace de `node_modules`). Ya existe `decisions.jsonl`, pero solo guarda decisiones y nadie
las inyecta en las tareas.

## What Changes

- Memoria mínima y propia sobre `decisions.jsonl`: entradas con tipo (`decisión`, `aprendizaje`,
  `preferencia`), texto corto, etiquetas (archivos o áreas) y fuente.
- Al encargar una tarea, Silka antepone al prompt del agente solo las entradas relevantes para su alcance, con
  tope de tamaño, y las pasa por referencia si no caben.
- El manager y el humano agregan entradas con la API y la CLI; las fichas fallidas pueden proponer un aprendizaje
  que el humano confirma.
- Entradas vencidas o reemplazadas se marcan, no se borran.

**Fuera de alcance:** búsqueda semántica o embeddings; sincronizar con Engram (queda como integración opcional
futura); memoria compartida entre usuarios.

## Capabilities

### New Capabilities

- `memory`: memoria persistente de decisiones, aprendizajes y preferencias, inyectada de forma acotada en las
  tareas según su alcance.

### Modified Capabilities

(ninguna)

## Impact

- `src/silka/state.mjs` (decisiones), `shims/agent-shim.mjs` o el encargo de tareas (inyección), Code Mode
  (`silka.memory.*`) y la CLI (`silka memory add|ls`).
- Aumenta un poco el prompt de cada tarea; se acota con el presupuesto de contexto de F5.
