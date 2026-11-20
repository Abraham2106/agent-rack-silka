# E2E Silka

Commit probado: `62cd500` (`silka-roadmap`). Hub `127.0.0.1:8987` dejado en marcha. No se tocaron `~/.codex`, `~/.cursor`, `~/.config/opencode` ni la config de Claude. Las sesiones ajenas no se cancelaron.

## Resumen

**27/29 pasan.**

Dos casos fallan: la instalación desde cero y el error de modelo inválido. Hay un tercer defecto, de severidad baja, visto durante el estado compartido (un archivo escrito fuera del agente quedó a su nombre).

## Tabla

| # | Caso | Comando | Esperado | Real | |
|---|---|---|---|---|---|
| 1 | Instalación desde cero | `git clone` del repo a `%LOCALAPPDATA%\Temp\silka-e2e\clone` y `npm run setup -- --no-register --no-skill --workspace <tmp>` | Config válida y ayuda lista para correr | `ERR_MODULE_NOT_FOUND: Cannot find package 'agent-rack'` antes de `npm install`. Exit 1 | FALLA |
| 2 | `silka --help` | En el clon, después de `npm install` a mano y repetir el setup | Texto de ayuda, exit 0 | Ayuda completa. El setup ya con `node_modules` escribió la config, validó y dejó el registro en dry-run | PASA |
| 3 | `ls` | `npm run silka -- ls` | Tabla de sesiones del hub | Tabla con id, agente, estado, tiempo, origen y prompt | PASA |
| 4 | `run` opencode | `run opencode "Crea e2e-cli-opencode.txt … pong" --workspace sandbox` | Sesión y archivo | `6e300594` completó `LISTO`. Archivo: `pong` | PASA |
| 5 | `run` cursor | `run cursor … --model grok-4.7-medium-fast --workspace sandbox` | Sesión con ese modelo y archivo | `a86a6908`. Meta `model=grok-4.7-medium-fast`. Archivo: `cursor` | PASA |
| 6 | `run` codex | `run codex "Crea e2e-cli-codex.txt …" --workspace sandbox` | Sesión y archivo | `5e998231` completó `LISTO`. Archivo: `codex` | PASA |
| 7 | `send` en cola | `send 6e300594 "… dos"` mientras el primer turno seguía | Aviso de cola y envío al terminar | `en cola: esperando a que termine el turno…` y luego `enviado 6e300594`. El archivo quedó `pong` + `dos` | PASA |
| 8 | `send` directo | `send 6e300594 "Responde solo: tres…"` con la sesión ya `completed` | Envío sin cola | `enviado 6e300594` sin la línea de cola. Resumen final: `tres` | PASA |
| 9 | `steer` | `steer 6e300594 "Responde solo: redirigido…"` | Nueva sesión, mismo agente, instrucción con prioridad | `197020df`, `steeredFrom=6e300594`, modelo `opencode/hy4-flash-free`, resumen `redirigido` | PASA |
| 10 | `note` | `note 6e300594 "nota e2e cli revisa el diff"` | Id de nota | `da9b9920-bf00-4965-91a3-f4427d0c226c` | PASA |
| 11 | Sin hub | En el clon, `port` 18987 (nadie escucha) y `silka ls` | Error que pide levantar el hub | `No hay hub. corre: silka hub`. Exit 1. El hub de 8987 no se tocó | PASA |
| 12 | Agente inexistente | `run nope "hola"` | Error con la lista real | `Agente 'nope' no está en la config. Disponibles: codex, opencode, cursor`. Exit 1 | PASA |
| 13 | Id inexistente | `note` / `send` / `steer` con `deadbeef000` | Error de sesión | Los tres: `No hay sesión 'deadbeef000'.` Exit 1 | PASA |
| 14 | Modelo inválido | `run opencode "responde solo ok" --model modelo-que-no-existe-e2e --workspace sandbox` | Error que nombre el modelo | Exit 0 y sesión `a5aaaf32`. A los 2 s quedó `completed` con resumen `error`. El log solo tiene `✗ error` | FALLA |
| 15 | Workspace no permitido | `run opencode … --workspace %LOCALAPPDATA%\Temp\silka-e2e\denied` | Rechazo | `not within allowedWorkspaces` (Development y Personal). Exit 1 | PASA |
| 16 | Bridge `listTools` | Cliente MCP contra `node src/silka/cli.mjs bridge` | Tools del hub más las de Silka | Incluye `opencode_run`, `silka_notes`, `silka_state`, `silka_changes`, `silka_decide`, `silka_decisions` | PASA |
| 17 | `opencode_run` | Mismo cliente, prompt que crea `e2e-bridge-opencode.txt` | Texto corto y archivo | `isError=false`, texto `LISTO`. Archivo: `bridge` | PASA |
| 18 | `silka_notes` | `markRead: false` | Notas sin leer, incluida la del caso 10 | JSON con `da9b9920` y las notas de conflicto | PASA |
| 19 | `silka_state` | `workspace=sandbox` | Bloque de hasta 15 líneas | Rama `master @ fb1675a`, líneas `otros:`, decisión y grafo | PASA |
| 20 | `silka_decide` | texto `e2e: decision de prueba del bridge` | Línea con fecha y autor | `2026-11-20T22:38:32.712Z e2e-bridge: e2e: decision de prueba del bridge` | PASA |
| 21 | `silka_changes` | sin `since` | Cambios de las últimas 2 horas | Lista con archivos y resúmenes, incluida `e2e-cli-opencode.txt` | PASA |
| 22 | `SILKA_DEPTH=2` | Otro bridge con esa variable | No lista herramientas de delegación y rechaza `opencode_run` | `listTools` no trae `*_run` ni `agent_session_create`. La llamada responde `No se puede delegar: SILKA_DEPTH=2 ya alcanzó el máximo (2)` | PASA |
| 23 | Estado, dos sesiones seguidas | Opencode crea `e2e-seq-a.txt` (`SEQ_A_77`); la siguiente debe verlo | El prompt de la segunda lleva el cambio | `e2e-seq-b.txt` = `otros: opencode e2e-bridge-opencode.txt, e2e-seq-a.txt — LISTO`. El log `last-opencode.log` antepone `Estado del proyecto (silka)` | PASA |
| 24 | Estado, dos a la vez | Dos opencode sobre `e2e-conflict.txt` (`775ec584`, `084f5b58`) | Conflicto y nota | Las dos tareas dejan el archivo en `ambiguous`. `conflicts` anota `e2e-conflict.txt`. Nota en ambas sesiones: `Conflicto: opencode 4cd6bb77 y opencode f224e0e7 tocan e2e-conflict.txt a la vez.` El TUI mostró `N!` en las dos filas | PASA |
| 25 | `graph status` | `silka graph status sandbox` | Estado de Graphify y del grafo | `Graphify: graphify 0.9.114` y `sandbox\graphify-out\graph.json` | PASA |
| 26 | `graph build` | `silka graph build sandbox` | AST y `graph.json` | `3 nodes, 3 edges`. El status final repite las herramientas `query_graph, get_node, get_neighbors` | PASA |
| 27 | Codex delega a opencode | `run codex` pidiendo solo `opencode_run` (el MCP `agent-rack` ya apuntaba al bridge; no se reescribió config) | `parentSessionId`, depth 1, resumen corto | Padre `b424c157` resumen `child-ok`. Hija `7cb4352c` opencode, origen `codex`, `depth: 1`, `parentSessionId` del padre, resumen `hola` | PASA |
| 28 | TUI | `silka ui` en ConPTY de 120×40 | Lista, panel en vivo, ayuda y teclas | Se vio el encabezado `hub :8987 ● vivo`, la lista, el panel (`→ $ powershell…`, `→ write e2e-conflict.txt`, `✎ LISTO`, `resumen`) y el anidado `↳ 197020df` bajo `6e300594`. Teclas no concluidas: ver abajo | PASA |
| 29 | `npm run smoke` | `npm run smoke` | Los tres agentes crean `sandbox/smoke-<agente>.txt` | codex 21 s, opencode 8 s, cursor 16 s. Los tres `isError=false`, respuesta con `LISTO`, archivo `hola "mundo" & 100%`. Exit 0. Aviso: el sidecar SSE no pudo usar el 8987 (`EADDRINUSE`) y siguió solo por stdio | PASA |

## TUI: qué no quedó probado

El frame bueno salió al cerrar el PTY; ConPTY no entregó frames intermedios, así que las teclas no se pudieron afirmar:

- `?` (ayuda), `e` (estado), `n` (asistente de sesión), `i` (redirigir), `m` (nota guardada), `c` con confirmación y `q`.
- Un intento temprano metió el texto en el composer (`› mnota-tui-e2e innq`) en vez de abrir modos.
- Varios arranques seguidos salieron al momento, con 83 bytes y sin dibujar.

La fila, el panel en vivo, `N`, `!` y el anidado sí se leyeron en un frame completo.

## Fallas

### 1. Alta — `npm run setup` no instala un clon limpio

El comando documentado muere al cargar el script, antes de llegar al `npm install`.

Reproducir:

```bash
git clone <este repo> /tmp/silka
cd /tmp/silka
npm run setup -- --no-register --no-skill --workspace /tmp/silka-ws
```

Resultado: `Cannot find package 'agent-rack' imported from …/src/silka/hub.mjs`.

Sospecha: `scripts/setup.mjs` importa `connect.mjs` en la carga del módulo. `connect.mjs` importa `repoRoot` desde `hub.mjs`, y `hub.mjs` importa `agent-rack` en la primera línea. Esa cadena corre antes del bloque que hace `npm install` cuando falta `node_modules/agent-rack`. Con las dependencias ya instaladas, el mismo setup termina bien.

### 2. Media — modelo inválido termina en la palabra `error`

`silka run` devuelve el id y sale 0 (el turno es en segundo plano). La sesión `a5aaaf32` acabó en 2 s con `summary: "error"`, `is_error: true` y un solo evento `✗ error`. No dice que `modelo-que-no-existe-e2e` no existe.

Reproducir:

```bash
npm run silka -- run opencode "responde solo ok" --model modelo-que-no-existe-e2e --workspace sandbox
```

Sospecha: `onOpencodeEvent` en `shims/agent-shim.mjs`. Ante `type === 'error'` usa `ev.error.data.message`, luego `ev.error.name`, y si no hay ninguno guarda el literal `'error'`. `finishOpencode` publica esa cadena como resultado.

### 3. Baja — un archivo ajeno queda como cambio del agente

La tarea de codex `b5a649ce` (sesión `5e998231`, 22:38:14–22:38:41) registró `files: ["e2e-bridge.mjs", "e2e-cli-codex.txt"]`. El agente solo debía crear `e2e-cli-codex.txt`. `e2e-bridge.mjs` lo escribió el arnés de prueba en `sandbox/` durante esa ventana. `silka_changes` lo mostró como cambio de codex.

Reproducir: lanzar un turno con workspace `sandbox` y, antes de que termine, crear otro archivo visible para `git status` en ese workspace.

Sospecha: `captureFiles` / `changedPaths` / `attributeChanges` en `src/silka/state.mjs`. El diff es todo el `git status` del workspace entre el inicio y el fin del turno, no solo lo que el proceso del agente escribió.
