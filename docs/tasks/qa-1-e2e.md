Rol: tester E2E de Silka. NO corriges código. Pruebas todo de punta a punta y escribes un reporte.

Contexto: Silka es este repo. Tiene `src/silka/` (hub, TUI, steer, notas, bridge, connect, estado compartido, graph), `shims/agent-shim.mjs`, `scripts/setup.mjs`, `scripts/smoke.mjs` y `scripts/delegate.mjs`. El README describe cómo se usa. Agentes instalados: codex, opencode (modelo opencode/hy4-flash-free) y cursor.

Reglas:
- No modifiques archivos del repo, salvo tu reporte. Para pruebas usa `sandbox/` o una carpeta temporal.
- El hub del puerto 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node. Cancela solo las sesiones que tú crees.
- No toques las configs de `~/.codex`, `~/.cursor`, `~/.config/opencode` ni de Claude. Para `connect` usa solo `--dry-run`.
- Para ahorrar, usa modelos rápidos en tus pruebas: cursor `grok-4.7-medium-fast` y opencode el modelo por defecto.

Qué probar (cada caso: comando, resultado esperado, resultado real, PASA/FALLA):
1. Instalación desde cero: `git clone` de este repo a una carpeta temporal, `npm run setup -- --no-register --no-skill --workspace <tmp>` y `npm run silka -- --help`.
2. CLI: `ls`, `run` (los tres agentes), `send` (en cola y directo), `steer`, `note`, y los errores: sin hub, agente inexistente, id inexistente, modelo inválido y workspace no permitido.
3. Bridge con un cliente MCP (`@modelcontextprotocol/sdk`) contra `node src/silka/cli.mjs bridge`: listTools, `opencode_run`, `silka_notes`, `silka_state`, `silka_decide`, `silka_changes`, y la guarda de profundidad (`SILKA_DEPTH=2`).
4. Estado compartido en `sandbox/`: dos sesiones seguidas (la segunda debe recibir el cambio de la primera) y dos a la vez sobre el mismo archivo (conflicto y nota).
5. Graph: `silka graph status` y `silka graph build sandbox`.
6. Codex delegando a opencode por el bridge: parentSessionId, depth 1 y summary corto.
7. TUI: renderízalo en una terminal y prueba lo que puedas: lista, panel en vivo, `?`, `e`, `n`, `i`, `m`, `c` con confirmación y `q`. Anota lo que no pudiste probar.
8. `npm run smoke`.

Entrega: escribe `docs/reports/e2e.md` con:
- Resumen: X/Y pasan.
- Tabla de casos.
- Lista de fallas, cada una con severidad (alta/media/baja), cómo reproducirla y el archivo o función sospechosa.

Responde en 6 líneas o menos con el conteo y las 3 fallas más graves.
