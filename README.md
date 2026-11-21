<p align="center">
  <img src="docs/assets/logo.png" alt="agent-rack-silka" width="220">
</p>

<h1 align="center">agent-rack-silka</h1>

<p align="center"><strong>Claude manda, Codex / OpenCode / Cursor trabajan.</strong></p>

Claude Code delega tareas de código a otros agentes CLI con **un solo tool call MCP** y recibe
solo la respuesta final (pocas líneas), sin el transcript. Es como un "CLI-anything" para
agentes: Claude dice qué hacer, cuál es el alcance, qué entregar y cómo probarlo, y sigue con lo suyo.

Se construye sobre [agent-rack](https://github.com/lakpriya1s/agent-rack) (MIT) y agrega:

- **Soporte real para Windows.** agent-rack no se instala ahí por defecto y rechaza prompts multilínea con CLIs `.cmd`.
- **Cursor** como sub-agente, porque agent-rack no lo trae.
- **OpenCode** con salida JSON limpia en vez de texto de terminal, y que sobrevive a sus auto-actualizaciones.
- **Setup de un comando**: detecta tus agentes, genera la config, registra el MCP en Claude Code e instala el skill `delegar`.

```
Claude ──codex_run / agent_session_create──▶ agent-rack (MCP) ──▶ shims/agent-shim.mjs ──▶ codex | opencode | cursor-agent
   ▲                                                                                               │
   └───────────────────────────── respuesta final (JSON corto) ◀───────────────────────────────────┘
```

## Instalación

Requisitos: **Node.js 20+**, [Claude Code](https://claude.com/claude-code) y al menos uno de:

| Agente | Instalar | Login |
|---|---|---|
| Codex | `npm i -g @openai/codex` | `codex login` |
| OpenCode | `npm i -g opencode-ai` | `opencode auth login` |
| Cursor | [cursor.com/cli](https://cursor.com/cli) | `cursor-agent login` |

```bash
git clone https://github.com/Abraham2106/agent-rack-silka.git
cd agent-rack-silka
npm run setup
```

Luego **reinicia Claude Code** y prueba con:

```bash
npm run smoke
```

`smoke` le pide a cada agente que cree un archivo en `sandbox/` y muestra el tiempo, la respuesta y el resultado.

### Opciones del setup

```bash
npm run setup -- --workspace ~/code --workspace ~/work   # dónde pueden trabajar los agentes (defecto: carpeta padre del repo)
npm run setup -- --codex-model gpt-5.1-codex             # modelo de Codex (defecto: el de ~/.codex/config.toml)
npm run setup -- --opencode-model openrouter/qwen/qwen3-coder
npm run setup -- --policy read-only                      # read-only | workspace-write (defecto) | danger-full-access
npm run setup -- --scope project                         # user (defecto) | project | local
npm run setup -- --no-register --no-skill
npm run setup -- --no-bridge          # MCP stdio directo, sin puente
npm run setup -- --connect all        # puente en Claude, Codex, Cursor y OpenCode
```

El setup es idempotente: vuelve a correrlo cuando instales otro agente o quieras cambiar algo.
Conserva las carpetas y modelos que no pases por flag.

## Uso desde Claude

Solo pídelo, por ejemplo: *"delega a Codex agregar paginación a /users, con tests"*. El skill
`delegar` le enseña a Claude cuándo delegar y cómo escribir un prompt corto. Las herramientas son:

| Herramienta | Qué hace |
|---|---|
| `codex_run` · `opencode_run` · `cursor_run` | Corre la tarea y espera a que termine. Parámetros: `prompt`, `workspace`, `timeoutSeconds`, `model`. |
| `agent_session_create` | Lanza en segundo plano y devuelve un `sessionId` al instante (hasta 5 en paralelo). |
| `agent_session_status` · `agent_session_logs` | Estado, y las últimas líneas del log (`tail`) solo si algo falla. |
| `agent_session_send` | Seguimiento en la misma conversación, por ejemplo "corre los tests y confirma". |
| `agent_review` | Revisión de solo lectura que devuelve `verdict` y `findings`, para que un agente revise a otro. |

Un buen prompt de delegación tiene cuatro cosas: **tarea, alcance, entrega y prueba**.

Para ver los agentes en vivo desde otra terminal: `npx agent-rack watch`.

## Tres modos

### Claude manager

Claude Code tiene el MCP `agent-rack` apuntando a `silka bridge`. Pides una delegación y la sesión corre en el hub compartido:

```text
delega a OpenCode, en este repo: responde solo ok
```

### TUI

Otra terminal maneja las mismas sesiones y muestra quién las lanzó:

```bash
npm run silka -- ui
```

### Puente entre agentes

Codex, Cursor y OpenCode pueden usar el mismo hub. Un agente lanza a otro y el TUI anida la sesión hija bajo quien la abrió. `SILKA_MAX_DEPTH` (por defecto 2) corta la cadena para que no se deleguen sin fin.

```bash
npm run silka -- connect all
npm run silka -- disconnect codex
```

`connect claude` reemplaza el registro stdio suelto de agent-rack. El setup lo hace solo; `--no-bridge` lo omite y `--connect all` registra los cuatro.

## TUI (silka)

`silka` arranca el hub SSE de agent-rack y maneja varias sesiones desde la terminal.

```bash
npm run silka -- hub
npm run silka -- ls
npm run silka -- run opencode "responde solo: ok" --model opencode/hy4-flash-free --workspace .
npm run silka -- send <id> "responde solo: dos"
npm run silka -- send <id> "no toques README.md" --now
npm run silka -- steer <id> "no toques README.md"
npm run silka -- note <id> "revisa el diff antes de aceptar"
npm run silka -- ui
npm run silka -- mcp
npm run silka -- bridge
npm run silka -- connect codex
```

`hub` usa `agent-rack.config.json` y escucha en `http://127.0.0.1:8987/sse` (o el `port` de la config). Si ya hay un hub con token y pid válidos, lo dice y sale sin error.

`send` encola. `send --now` (y `steer`, que es el mismo comando) interrumpe el turno y retoma la misma conversación: el agente suelta la herramienta en curso, como máximo a los 10 s, y recibe tu mensaje junto con lo que ya estaba en cola. `note` guarda una nota en `~/.config/silka/notes.jsonl`. `mcp` expone `silka_notes` para que el manager las lea.

En `ui`, el encabezado muestra el puerto del hub (vivo o caído) y cuántas sesiones hay. El TUI se dibuja en la pantalla alternativa y se restaura al salir (`SILKA_NO_FULLSCREEN=1` lo deja en el scrollback). ↑/↓ elige. Cada fila tiene ícono y color según el estado, el agente, el origen (`tú`, `claude-code`, `codex`…), el tiempo y una marca si hay mensajes en cola (`Q`) o notas (`N`). Si una sesión la lanzó otra, queda anidada debajo. A la derecha va el chat: Enter encola (⏳), Ctrl+Enter o Alt+Enter envían ya (⚡). ↑ elige un mensaje en cola y Esc lo borra. PgUp/PgDn, Inicio/Fin y la rueda mueven el chat. El encabezado del chat cuenta las interrupciones. `n` crea una sesión (agente con flechas, modelo opcional, prompt multilínea: Enter es otra línea y Ctrl+S envía). `m` deja una nota, `c` cancela con confirmación, `?` abre la ayuda y `q` sale. Sin hub, el error dice `corre: silka hub`.

`bridge` es el servidor MCP por stdio que reexpone las herramientas del hub (y `silka_notes`, `silka_state`, `silka_changes`, `silka_decide`, `silka_decisions`). Si el hub no está, lo arranca aparte y espera. `connect` / `disconnect` registran ese puente con el nombre `agent-rack`.

En `ui`, `e` abre la vista Estado del workspace de la sesión elegida: rama, HEAD, tareas, archivos, conflictos y decisiones. Si dos tareas en curso tocan el mismo archivo, la fila lleva `!` y queda una nota para el manager.

## Estado compartido

Cada turno que pasa por el shim anota en `<workspace>/.silka/` qué agente trabajó, desde qué commit y qué archivos tocó. `tasks.json` guarda la sesión, el origen, la rama, el commit base, el inicio, el fin, el estado y un resumen de una línea. Los archivos salen de comparar `git status --porcelain` y el hash de cada uno al empezar y al terminar. Si otro agente estaba en el mismo árbol, el archivo queda marcado como ambiguo. `decisions.jsonl` guarda decisiones con autor, fecha, sesión y texto.

Al empezar el turno, el shim antepone siempre como máximo 15 líneas, "Estado del proyecto (silka)": rama y HEAD, lo que cambiaron otros agentes en las últimas 2 horas, las tareas en curso y las últimas 3 decisiones. Si el prompt trae ese encabezado, se escapa y no sustituye al bloque real. Una tarea sin archivos dice "sin cambios". Sin repo git, el bloque es mínimo. No vuelca archivos.

Esas mismas líneas están en el bridge:

| Herramienta | Qué hace |
|---|---|
| `silka_state({workspace})` | El resumen compacto. |
| `silka_changes({workspace, since?})` | Cambios desde una fecha ISO (por defecto, 2 horas). |
| `silka_decide({workspace, text})` | Anota una decisión. |
| `silka_decisions({workspace, limit})` | Lee las últimas. |

Codex puede reenviar `SILKA_DEPTH` y `SILKA_AGENT` a sus servidores MCP con `env_vars` en `~/.codex/config.toml`. `silka connect codex` lo anota si falta. Cursor y OpenCode solo aceptan variables fijas (`--env` / `env`), no el valor del proceso padre. Si la variable no llega, el bridge toma la sesión en curso del mismo agente y workspace, guarda `parentSessionId` y `depth = profundidad del padre + 1`, y el TUI anida esa sesión debajo.

## Graphify (opcional)

[Graphify](https://github.com/graphify-labs/graphify) (`pip install graphifyy`) arma un grafo del repo. Silka no lo necesita: sin él, el estado, el bridge y el TUI siguen igual. `silka graph status` lo dice si no está instalado.

```bash
pip install --user graphifyy
npm run silka -- graph status .
npm run silka -- graph build .
npm run silka -- connect claude --with-graph
```

`graph build` corre `graphify extract <workspace> --code-only` (el AST, sin API) y deja `graphify-out/graph.json`. Si ese archivo existe, el bloque de estado agrega una línea con la ruta y las herramientas `query_graph`, `get_node` y `get_neighbors`. `--with-graph` registra el MCP (`graphify-mcp <graph.json>`) en ese harness.

## Cómo funciona

- [`shims/agent-shim.mjs`](shims/agent-shim.mjs) es el puente:
  - **Codex**: `codex exec --json`. El shim deja en stdout el hilo y el mensaje final, y manda el resto a stderr como pasos (`→ mcp agent-rack.opencode_run`, `→ $ cmd`), para que el resumen no arrastre el JSON.
  - **OpenCode**: `opencode run --format json`, leído línea por línea y traducido al formato JSON de Claude Code. Le indica el directorio de trabajo, porque OpenCode resuelve rutas relativas contra la raíz del repo git.
  - **Cursor**: `cursor-agent -p --output-format stream-json --stream-partial-output --trust`, leído línea por línea. `--permission-mode plan` se traduce a `--mode plan`. Con `workspace-write`: en macOS/Linux `--sandbox enabled --force` (sandbox real); en Windows Cursor no tiene sandbox, así que usa `--force` (desactívalo con `SILKA_CURSOR_FORCE=0` y Cursor solo correrá lo que permita `~/.cursor/cli-config.json`).
  - **Actividad en vivo**: cada paso de Cursor y OpenCode sale al momento por stderr (`→ read src/x.ts`, `→ $ npm test`, `✎ texto`). stdout queda en la línea final `{"type":"result",...}`, así el resumen del manager sigue corto.
  - En Windows lee el `.cmd` de npm en el PATH para encontrar el `.exe` o `.js` real. Así el prompt llega intacto (saltos de línea, comillas, `&`, `%`) y sigue funcionando aunque el CLI se actualice y cambie de ruta.
  - La salida cruda de la última corrida queda en `~/.config/silka/logs/last-<agente>.log` (y la anterior en `.1`), con tokens redactados. No se escribe dentro del repo.
- `agent-rack.config.json` lo genera el setup con rutas absolutas locales (está en `.gitignore`). Hay un ejemplo en [`agent-rack.config.example.json`](agent-rack.config.example.json).
- `.npmrc` trae `ignore-scripts=true` porque el postinstall de agent-rack es solo para Unix. `node-pty` ya incluye binarios precompilados.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| `The 'X' model is not supported when using Codex with a ChatGPT account` | `npm run setup -- --codex-model <modelo válido>` (por ejemplo `gpt-6.1-sol`). |
| OpenCode: `API key has expired` o `requires more credits` | `opencode auth login`, o usa otro modelo con `--opencode-model`. |
| OpenCode: `OpenCode X or newer is required to use the free tier` | `npm i -g opencode-ai@latest` |
| Cursor: `Authentication required` | `cursor-agent login` |
| La tarea se queda colgada (modelo con rate limit) | Baja `timeoutSeconds` o cambia de modelo. Revisa `~/.config/silka/logs/`. |
| `workspace ... not allowed` | Agrega la carpeta con `npm run setup -- --workspace <dir>`. |

## Seguridad

- Por defecto la política es `workspace-write`. Codex la aplica con su sandbox. Cursor y OpenCode no tienen sandbox de archivos, así que ahí se aplica por instrucciones.

### Qué implica cada política para Cursor

| Política | Cursor |
|---|---|
| `read-only` | `--mode plan`. No escribe. Sin `--force`. |
| `workspace-write` | macOS/Linux: `--sandbox enabled --force` (sandbox real de Cursor). Windows: `--force` sin sandbox, porque en headless Cursor rechaza todo comando fuera de su allowlist (por defecto solo `ls`). `SILKA_CURSOR_FORCE=0` lo desactiva. |
| `danger-full-access` | Añade `--force` (aprueba solo). Si el turno pide `--permission-mode plan`, gana `--mode plan` y no se usa `--force`. |

- Los agentes solo pueden trabajar dentro de `allowedWorkspaces`. El bridge rechaza un workspace con `..` o fuera de esa lista.
- agent-rack quita del entorno las variables que parecen secretos antes de lanzar cada agente. Cada CLI usa su propio login.

## Licencia

MIT. Incluye [agent-rack](https://github.com/lakpriya1s/agent-rack) como dependencia (MIT).
El diseño original de la idea está en [`docs/PLANTEAMIENTO.md`](docs/PLANTEAMIENTO.md).
