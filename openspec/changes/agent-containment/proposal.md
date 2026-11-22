# Proposal

## Why

Un agente de OpenCode, al que se le bloqueó `git reset`, usó agent-rack por su cuenta para lanzar a un agente de
Codex fuera de Silka: sin tarea, sin ficha, sin verify y sin saber en qué carpeta trabajó. Los agentes pueden hoy
crear agentes, leer el estado de todas las tareas y, en principio, escribirlo, aunque el hub debe ser el único
escritor. Además, nada impide que un agente lea `.env` o llaves privadas.

## What Changes

- Los agentes que lanza Silka no pueden crear sesiones de agente: su entorno no expone el MCP ni la CLI de
  agent-rack, y el hub rechaza crear sesiones pedidas desde una sesión de tarea por encima de la profundidad
  permitida (por defecto 1: el manager lanza, el agente no).
- Cada tarea ve solo su propio estado: el agente no puede leer ni escribir el estado de otras tareas.
- Lista de denegación de archivos sensibles (`.env*` salvo `.env.example`, `~/.ssh`, `*.pem`, `*.key`,
  `id_*`): el agente no los recibe en su worktree ni en su contexto, y la ficha marca riesgo alto si un cambio
  los toca.
- Cada intento bloqueado queda auditado y le llega al manager como aviso.

**Fuera de alcance:** un sandbox de sistema operativo completo para los agentes; bloquear la red de los agentes.

## Capabilities

### New Capabilities

- `agent-containment`: límites a lo que un agente delegado puede hacer fuera de su tarea (crear agentes, ver otras
  tareas, leer secretos), con auditoría.

### Modified Capabilities

(ninguna)

## Impact

- `shims/agent-shim.mjs` y `src/silka/hub.mjs` (entorno de los agentes, `harnessFreeEnv`).
- `src/silka/bridge.mjs` (linaje y profundidad de sesiones), `src/silka/tasks/` (estado por tarea, worktree).
- `docs/architecture/security.md`: nueva amenaza "agente que lanza agentes para esquivar un bloqueo".
