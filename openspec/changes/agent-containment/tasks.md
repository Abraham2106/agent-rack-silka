# Tasks

## 1. Agentes que no crean agentes

- [x] 1.1 Quitar del entorno de los agentes (shim y hub) el acceso al MCP y la CLI de agent-rack y verificar con una prueba que el entorno del agente no los expone
  - Codex: el shim lo lanza con `-c mcp_servers.agent-rack.enabled=false` al llegar al tope (`codex mcp list --json`). OpenCode 2.x: sus MCP los lanza un servicio que no hereda el entorno, por eso el shim usa `--standalone` y el bridge hereda `SILKA_DEPTH` y oculta las herramientas que crean agentes (probado con OpenCode real: depth 0 expone `agent_*`, depth 1 solo `silka_state/changes/decisions`). Cursor: en modo headless no carga el MCP de agent-rack ni a depth 0 en esta máquina, así que no hay nada que quitar ni se pudo probar la rama positiva; si lo carga, el mismo filtro del bridge aplica. La CLI `agent-rack` por shell no se bloquea (queda fuera de esta tarea).
- [x] 1.2 Aplicar en el hub el límite de profundidad sobre el linaje de sesiones ya registrado y verificar con pruebas de profundidad 1 y 2 (AC-01, AC-02)
  - El hub es agent-rack y no ve quién llama: los agentes le hablan por el bridge de Silka, así que el punto más bajo que Silka controla es el bridge, que usa el linaje registrado (`origins`, `resolveLineage`) cuando el entorno no trae `SILKA_DEPTH`. Tope por defecto 1 (antes 2); `SILKA_MAX_DEPTH=2` permite un nivel más.
- [x] 1.3 Probar con un agente real que intenta lanzar otro y verificar que se rechaza (correr `npm run e2e:worktree` y la prueba nueva)
  - `npm run e2e:contencion` (bridge real + OpenCode real a depth 1: no tiene la herramienta, `E_POLICY`, intento auditado) y `npm run e2e:worktree` (RESULTADO: OK).

## 2. Estado por tarea

- [x] 2.1 Limitar las lecturas y escrituras de estado de un agente a su propia tarea y verificar con una prueba que leer otra da `E_POLICY` (AC-03)

## 3. Secretos

- [x] 3.1 Lista de denegación configurable con valores por defecto y verificar que el worktree no recibe `.env` (AC-04)
- [x] 3.2 Riesgo alto en la ficha si el diff toca la lista y verificar con una prueba (AC-05)

## 4. Auditoría y documentación

- [x] 4.1 Auditar y avisar al manager de cada intento bloqueado y verificar con una prueba (AC-06)
- [x] 4.2 Agregar la amenaza "agente que lanza agentes para esquivar un bloqueo" a `docs/architecture/security.md` y verificar que enlaza a SEC-15..17
