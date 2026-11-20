Tarea: construir la fase 1 de Silka: un comando `silka` con un hub compartido y un TUI (estilo Claude Code) para ver y manejar varias sesiones de sub-agentes.

Contexto (no lo vuelvas a investigar):
- Repo Node ESM (`"type":"module"`, Node 22, Windows). Dependencia: agent-rack 0.12.1 (en node_modules, MIT). Instala dependencias nuevas con `npm install <pkg>`; `.npmrc` ya trae ignore-scripts.
- `npm run setup` genera `agent-rack.config.json` (agentes codex/opencode/cursor, puerto SSE por defecto 8987).
- El hub es agent-rack en modo SSE: `node node_modules/agent-rack/bin/agent-rack.js start -t sse -c agent-rack.config.json`. Escucha en `http://127.0.0.1:<port>/sse` y publica su token en `~/.config/agent-rack/runtime/sse-<port>.json` (`{port, token, pid, createdAt}`).
- Cliente listo para usar: `import { DashboardRemoteClient } from 'agent-rack/dist/cli/dashboard/remoteClient.js'`, con `new DashboardRemoteClient(url, token)`. Tiene `connect`, `listSessions`, `getSessionStatus`, `getSessionLogs(id, cursor, limit)`, `getSessionLogTail(id, n)`, `createSession(agent, prompt, workspace, model)`, `sendInput(id, msg)`, `cancelSession(id)` y `close`.
- Limitación conocida: `sendInput` falla si la sesión está `running` (codex/cursor/opencode responden reanudando en un turno nuevo). Por eso el TUI debe ENCOLAR el mensaje y enviarlo solo cuando la sesión deje de estar running.

Alcance:
- Código nuevo en `src/silka/` y una entrada `bin` "silka" en package.json (más el script `"silka": "node src/silka/cli.mjs"`).
- Usa Ink + React para el TUI (`npm install ink react`). Usa JSX solo si no requiere build; si no, `React.createElement` / `htm`.
- NO modifiques `shims/agent-shim.mjs`, `scripts/setup.mjs`, `scripts/smoke.mjs` ni nada en node_modules.

Entrega:
1. `silka hub`: arranca el hub SSE con la config del repo. Si ya hay uno vivo en el puerto (token y pid válidos), lo dice y sale sin error.
2. `silka ls`: lista las sesiones (id corto, agente, estado, duración, primeros 50 caracteres del prompt).
3. `silka run <agente> "<prompt>" [--model m] [--workspace dir]`: crea una sesión en segundo plano e imprime su id. El workspace por defecto es el cwd.
4. `silka send <id> "<mensaje>"`: si está running, espera a que termine y luego envía.
5. `silka ui`: TUI con:
   - Panel izquierdo con la lista de sesiones (↑/↓ para elegir). El estado tiene color: running, completed, failed.
   - Panel derecho con la actividad en vivo de la sesión elegida (polling cada 1-2 s, últimas ~30 líneas).
   - Caja de texto abajo: Enter envía al agente seleccionado. Si está running, el mensaje queda "en cola" (visible en el panel) y se envía automáticamente al terminar el turno.
   - Teclas: `n` nueva sesión (elegir agente, modelo opcional y prompt), `c` cancelar, `q` salir. Un mensaje de error claro si no hay hub ("corre: silka hub").
6. Una sección corta "TUI (silka)" en README.md con los comandos.

Prueba (córrela tú):
- `node src/silka/cli.mjs hub` en segundo plano. Después `node src/silka/cli.mjs run opencode "responde solo: ok"`, luego `ls` (debe aparecer) y `send <id> "responde solo: dos"` (debe encolar o enviar sin error).
- `node --check` sobre todos los archivos nuevos. Deja el hub apagado al terminar.

Al terminar responde en 8 líneas o menos: archivos creados o cambiados, cómo probaste, qué funcionó y qué no.
