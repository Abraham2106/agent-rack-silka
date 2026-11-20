Tarea: fase 3 de Silka. Un puente para que cualquier harness (Claude Code, Codex, Cursor, OpenCode) use el MISMO hub como manager, y para que el TUI muestre quién lanzó cada sesión.

Contexto (ya hecho):
- Fases 1 y 2 en `src/silka/`: hub SSE (agent-rack, puerto 8987, token en `~/.config/agent-rack/runtime/sse-8987.json`), `withClient`, TUI, `steer`, notas y `src/silka/mcp.mjs` con `silka_notes`.
- Hoy Claude Code tiene registrado `agent-rack` por stdio (un servidor aparte por sesión). Por eso sus sub-agentes NO aparecen en el hub ni en el TUI.
- Comandos para registrar MCP: `codex mcp add|list|remove`, `opencode mcp ...` (mira su `--help`), `cursor-agent mcp ...` (en Windows es `cursor-agent.cmd` o `agent`; mira su `--help`). Para Claude Code: `claude mcp add|remove|get`.

Alcance: `src/silka/`, `shims/agent-shim.mjs`, `scripts/setup.mjs`, README.md y `skills/delegar/SKILL.md`. No toques node_modules.

Entrega:
1. `silka bridge`: servidor MCP por stdio que hace de proxy al hub.
   - Si no hay hub vivo, lo arranca separado del proceso (detached) y espera a que esté listo.
   - Re-expone las herramientas del hub con los mismos nombres (`agent_run`, `codex_run`, `agent_session_create`, etc.) más `silka_notes`.
   - Al crear una sesión, guarda su origen en `~/.config/silka/sessions.json` (`{sessionId: {from, depth, at}}`). `from` sale de `clientInfo.name` del initialize de MCP (por ejemplo claude-code o codex) o de la variable `SILKA_AGENT`.
2. Guarda contra recursión.
   - El shim fija `SILKA_DEPTH` (+1) y `SILKA_AGENT=<agente>` en el entorno de cada sub-agente.
   - El hub no conserva el entorno del que llama. Por eso el bridge antepone al prompt una marca `[silka depth=N from=X]`, y el shim la lee, la quita del prompt y la usa.
   - Con `SILKA_DEPTH >= SILKA_MAX_DEPTH` (por defecto 2), el bridge oculta o rechaza las herramientas que delegan, con un mensaje claro.
3. `silka connect <claude|codex|cursor|opencode|all>` y `silka disconnect <...>`.
   - Registran `silka bridge` como servidor MCP llamado `agent-rack` en cada CLI, con su comando oficial. Usa ruta absoluta a node y a `src/silka/cli.mjs`.
   - Si no hay comando oficial, edita su JSON de config con un respaldo `.bak`.
   - Son idempotentes. `connect claude` reemplaza el registro stdio actual, así Claude Code comparte el hub.
   - El setup llama `connect claude` por defecto (con `--no-bridge` para no hacerlo) y ofrece `--connect all`.
4. TUI:
   - Columna o etiqueta "origen" en cada sesión (tú, claude-code, codex, …), con sesiones hijas anidadas bajo su padre cuando se pueda.
   - Arregla que el texto `✎` en vivo se parta a mitad de palabra u oración: agrupa los fragmentos hasta un salto de línea o una pausa.
5. README: una sección "Tres modos": Claude manager, TUI y puente entre agentes, con un ejemplo corto de cada uno.

Prueba (córrela tú):
- IMPORTANTE: el hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node.
- Corre `connect codex`, `connect opencode` y `connect cursor` de verdad, y verifica con el `mcp list` de cada CLI.
- NO corras `connect claude` (yo lo hago al revisar), pero sí prueba su versión `--dry-run`, que imprime lo que haría.
- Con un cliente MCP de prueba contra `silka bridge` (clientInfo name "prueba"): `agent_run` de opencode responde, y la sesión aparece en `silka ls` y en el TUI con origen "prueba".
- Fuerza `SILKA_DEPTH=2` y verifica que delegar se rechaza.
- `node --check` en todo y `npm run smoke` (los tres agentes deben pasar).

Al terminar responde en 10 líneas o menos: archivos, qué probaste, qué funcionó y qué no, y qué configs externas modificaste (con sus rutas de respaldo).
