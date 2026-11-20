Tarea: fase 2 de Silka. Actividad en vivo de los agentes, poder redirigirlos, notas para el manager y un TUI pulido.

Contexto (ya está hecho; no lo re-investigues a fondo):
- Fase 1 en `src/silka/` (cli, hub, commands, format, ui con Ink). `silka hub|ls|run|send|ui` funcionan. `send` encola el mensaje si la sesión está running.
- Agentes: `shims/agent-shim.mjs` traduce cursor y opencode al protocolo JSON de Claude Code (transporte `claude_stream_json` de agent-rack). Hoy cursor corre con `--output-format json`, así que solo hay UN evento al final y el TUI no ve nada en vivo. Codex usa `codex exec --json` (JSONL) vía el mismo shim.
- agent-rack guarda el stderr del proceso como eventos `status` con `metadata.stream === 'stderr'`. Esos eventos NO entran en el resumen final (`summary`), así que son un buen canal de progreso que no gasta tokens del manager.

Alcance: `src/silka/`, `shims/agent-shim.mjs`, README.md y package.json si hace falta. No toques `node_modules`.

Entrega:
1. Actividad en vivo (cursor y opencode). En el shim:
   - Cursor: usa `--output-format stream-json` (con `--stream-partial-output` solo si ayuda) y procesa línea por línea.
   - OpenCode: ya emite JSONL, pero hoy se lee en bloque. Procésalo en streaming.
   - Escribe en **stderr**, inmediatamente y en una línea corta y legible, cada paso: `→ read src/x.ts`, `→ edit src/x.ts`, `→ $ npm test`, `✎ <texto corto>`.
   - **stdout** queda solo con la línea final `{"type":"result",...}`, para que el resumen siga corto.
   - Comprueba con una sesión real que esas líneas aparecen en `getSessionLogs` mientras corre.
2. El TUI muestra esa actividad en el panel derecho y hace auto-scroll. Para codex, muestra sus eventos (comandos, cambios de archivos, mensajes) de forma igual de legible, no como JSON crudo.
3. Redirigir: tecla `i` en el TUI y `silka steer <id> "<instrucción>"`.
   - Cancela la sesión y crea una nueva con el mismo agente, modelo y workspace.
   - El prompt de la nueva es: el prompt original + "INSTRUCCIÓN NUEVA DEL USUARIO (tiene prioridad): …" + "Continúa desde el estado actual de los archivos; no rehagas lo que ya está bien."
   - agent-rack no permite reanudar una sesión cancelada, por eso se crea una nueva.
   - El TUI liga visualmente la sesión nueva con la anterior.
4. Notas para el manager. Tecla `m` en el TUI y `silka note <id> "<texto>"`.
   - Se guardan en `~/.config/silka/notes.jsonl` como `{id, sessionId, text, at, read:false}`.
   - Crea un servidor MCP mínimo `src/silka/mcp.mjs` (stdio, con `@modelcontextprotocol/sdk`, que ya está instalado) con la herramienta `silka_notes({sessionId?, markRead=true})`, que devuelve las notas no leídas.
   - Agrega `silka mcp` para arrancarlo.
   - En `scripts/setup.mjs` regístralo en Claude Code como un segundo servidor `silka` (mismo estilo que agent-rack).
   - En `skills/delegar/SKILL.md` añade una línea: "al revisar una sesión, llama `silka_notes`".
5. TUI pulido (lo más importante para el usuario):
   - Encabezado con el hub (puerto y vivo o caído) y el número de sesiones.
   - Lista con ícono y color por estado, agente, modelo, tiempo transcurrido y una marca si hay mensajes en cola o notas.
   - En el panel derecho, debajo de la actividad, el resumen final cuando termina.
   - Flujo `n` claro: elegir agente con flechas, modelo opcional y prompt multilínea (Ctrl+Enter o una tecla clara para enviar).
   - Confirmación antes de `c` (cancelar).
   - Ayuda con `?`.
   - Sin parpadeos y usable en una terminal de 100 columnas.
   - Que se vea profesional, sobrio y consistente.

Prueba (córrela tú y deja todo apagado al final):
- Levanta el hub (`node src/silka/cli.mjs hub` en segundo plano).
- `run cursor "lista los archivos de src/silka y di cuántos hay"` con `--model grok-4.7-medium-fast`: mientras corre, `getSessionLogs` debe mostrar pasos (`→ …`), y el summary final debe ser corto.
- `steer` sobre una sesión running de opencode crea la sesión nueva con la instrucción.
- `note` + llamar `silka_notes` con un cliente MCP de prueba devuelve la nota.
- Renderiza el TUI y verifica los paneles y la ayuda. `node --check` en todo.

Al terminar responde en 10 líneas o menos: qué archivos cambiaste, qué probaste, qué funcionó y qué no.
