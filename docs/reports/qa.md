# QA Silka — silka-roadmap @ 62cd500

Revisión de solo lectura (código, logs ya escritos, ACL del token, tamaño del bloque de estado). No se tocó el hub del puerto 8987. `silka ui` no se abrió: esta sesión no es una TTY y el CLI sale con «silka ui necesita una terminal interactiva». La UX se revisó sobre el layout de `ui.mjs` a 100 y a 60 columnas.

## Veredicto

Silka ya cumple el esqueleto del producto: un hub compartido, un shim que no vuelca el stream al manager y un bloque de estado de como máximo 15 líneas. No está listo para que alguien lo use sin ayuda. Cursor escribe con `--force` y sin sandbox, el bridge deja que un sub-agente maneje el hub y escriba fuera de `allowedWorkspaces`, y el estado «verificable» es texto que el propio prompt puede sustituir. En esta máquina el log de Cursor pesa 4,2 MB dentro del repo, y el default de setup abre el directorio padre (aquí, `Development` y `Personal` enteros).

## Hallazgos

### 1. Alta — Cursor ignora la política y lanza `--force`

`shims/agent-shim.mjs:460-464`

En modo escritura el shim añade siempre `--trust` y `--force`. agent-rack, para `claude_stream_json`, manda `--permission-mode acceptEdits` o `plan` (`node_modules/agent-rack/dist/adapters/claude.js:90-94`). El shim se traga ese flag (`agent-shim.mjs:35`) y solo trata `plan` como lectura. Con `workspace-write` el proceso queda con aprobación automática de shell y sin sandbox. El planteamiento pedía `--force` solo dentro de un worktree; no hay worktree. Codex sí recibe `--sandbox` (el log de hoy lo muestra). Cursor y OpenCode no.

Arreglo: no añadir `--force` salvo `security.executionPolicy === 'danger-full-access'`. En `workspace-write`, dejar el CLI pidiendo confirmación o limitar el shell al workspace. Reenviar el modo en vez de descartarlo. Reservar `--trust` al directorio ya validado por `validateWorkspacePath`.

### 2. Alta — El bridge expone el hub entero y las herramientas `silka_*` no miran el allowlist

`src/silka/bridge.mjs:119-124`, `src/silka/bridge.mjs:192-215`, `src/silka/bridge.mjs:244-270`

`isDelegatingTool` solo corta `*_run`, `agent_session_create` y `agent_review`. Un sub-agente sigue viendo `agent_session_send`, `agent_session_cancel`, `agent_session_logs`, `agent_session_delete` y `agent_session_list`. Puede leer el log de otra sesión, inyectarle un mensaje o cancelarla. `silka_notes` viene con `markRead: true` por defecto (`notes.mjs:52-59`): el sub-agente se come las notas antes de que las vea el manager.

`localTool` acepta cualquier `workspace` y `appendDecision` hace `mkdir` de `<ruta>/.silka` (`state.mjs:416-420`). agent-rack sí filtra con `validateWorkspacePath`. El puente no. El token del hub en sí está bien planteado: agent-rack escucha en `127.0.0.1` y exige bearer. En Windows el `chmod 0600` no aplica; la ACL de `sse-8987.json` es la del perfil (usuario, Administradores, SYSTEM), no un 0600 real.

Arreglo: al llegar a `maxDepth`, dejar solo `silka_state`, `silka_changes` y `silka_decisions` de lectura. `silka_notes` solo para el cliente manager (`from` vacío o `claude`). Antes de leer o escribir, llamar a `validateWorkspacePath` con `allowedWorkspaces` de la config. `markRead` por defecto `false` cuando el caller no es el manager.

### 3. Alta — El estado se puede falsificar y no es verificable

`src/silka/state.mjs:279-281`

Si el prompt empieza por `Estado del proyecto (silka)`, `beginTurn` no antepone el bloque real. Quien escribe el prompt (el manager, o un agente que delega) sustituye rama, HEAD, tareas y decisiones. El bloque tampoco va delimitado como datos: los resúmenes de otros agentes entran en crudo (`formatBlock`, líneas 243-249, 48 caracteres). La marca `[silka depth=… from=…]` sí se reescribe en el bridge (`bridge.mjs:139-141`), así que por ahí no se sube la profundidad. `from` no se sanea más allá de quitar `[]` (`bridge.mjs:131-136`); un salto de línea cabe en la marca y `origin.mjs:19-22` lo conserva si el nombre no contiene `claude|codex|cursor|opencode`.

Arreglo: anteponer el bloque siempre, después de quitar un encabezado falso. Envolverlo en un delimitador fijo y decir en una línea que es dato, no instrucción. Pasar `from` por `originLabel` y rechazar controles (`\r`, `\n`).

### 4. Alta — Lo que vuelve al manager no tiene tope; el fallo le pega el stream

`shims/agent-shim.mjs:410-420`, `shims/agent-shim.mjs:423-429`

El camino feliz de Cursor/OpenCode manda una sola línea `type:result` y los pasos van a stderr. Eso está bien y evita el `### Tool Calls Executed` de agent-rack. Nadie recorta `result`. En el log de Cursor de hoy el resultado mide 1711 caracteres. Si no hay `result`, se mandan los últimos 2000 caracteres del stdout (el stream-json, con contenido de archivos) y, si hay error, otros 1500 de stderr. OpenCode devuelve el último `part.text` o todos los errores concatenados, sin límite. El skill pide ≤5 líneas; el código no lo exige.

El bloque hacia el worker sí cabe en 15 líneas (`state.mjs:252`). Hoy, en este repo, son 4 líneas y 85 caracteres. En un prompt real guardado en `shims/logs/last-codex.log` el tope se llenó y una línea metía rutas de `graphify-out/cache/.../<hash>.json`. `taskFiles` ya excluye ese prefijo (`state.mjs:218-221`); `fileList` (`state.mjs:210-216`) sigue sin recortar la ruta, y las líneas `otros:` se repiten. OpenCode declaró 7719 tokens de entrada en una respuesta de una palabra: la mayor parte es el sistema del modelo, no Silka, pero el bloque no ayuda cuando una línea son cientos de caracteres.

Arreglo: recortar el `result` a unas 8 líneas o ~600 caracteres antes de `emit`, y no adjuntar stdout crudo. En el fallo, una línea `exit` + el último `✗`. En `fileList`, `oneLine(ruta, 40)` y no repetir la misma pareja agente+archivos.

### 5. Alta — Los logs guardan el stream completo dentro del workspace permitido

`shims/agent-shim.mjs:556-563`

`writeLog` vuelca stdout y stderr enteros. `shims/logs/last-cursor.log` pesa 4 275 818 bytes: 7131 eventos `thinking`, 398 `tool_call` y el contenido de los archivos que el agente leyó. Está en `.gitignore`, pero el directorio vive dentro del repo y el default de `allowedWorkspaces` incluye ese repo. El siguiente Cursor con `--force` puede leerlo. El prompt se corta a 8000 caracteres; el stream no. No hay redacción.

`last-codex.log` además reenvía el stderr de Codex al proceso (`agent-shim.mjs:536-539`). Ahí aparecen errores de MCP ajenos (OAuth de otros servidores, sin el bearer). Si el turno no produce texto, agent-rack mete ese stderr en el summary (`describeEmptyResult`).

Arreglo: loguear solo cabecera, exit y las líneas `→`/`✎` ya recortadas, o desactivar el log salvo `SILKA_DEBUG=1`. Escribirlo en `%LOCALAPPDATA%\silka\logs`, fuera del workspace. No reenviar el stderr crudo de Codex; pasarlo por `clipStep`.

### 6. Alta — Carreras al escribir el estado compartido

`src/silka/notes.mjs:52-59`, `src/silka/origin.mjs:25-37`, `src/silka/hub.mjs:98-109`, `src/silka/state.mjs:33-56`, `src/silka/commands.mjs:87-94`

- `unreadNotes` lee todo el archivo y lo reescribe. `appendNote` hace `appendFile`. Si una nota llega entre medias, `writeNotes` la borra.
- `rememberOrigin` y `rememberSession` son leer-modificar-escribir sin cerrojo. Dos altas a la vez pierden un origen y el TUI deja de anidar.
- `withLock` espera 4 s y luego ejecuta igual, sin el lock (`state.mjs:55`). A los 8 s otro proceso borra el lock por mtime (`state.mjs:50`) aunque el dueño siga dentro. `refreshConflicts` llama a `captureFiles` con el lock tomado (`state.mjs:336-338`); un `git status` lento en un árbol sucio dispara las dos cosas.
- `waitUntilSettled` sale a los 20 s aunque la sesión siga `running`, y `redirectSession` crea otra. Quedan dos agentes sobre los mismos archivos. El timeout no es un error.

`attachTurn` se traga cualquier fallo (`agent-shim.mjs:75-77`) y el agente corre sin estado y sin aviso.

Arreglo: un solo lockfile por archivo de `~/.config/silka` y por `silka-prompts.json`, el mismo patrón `wx` pero sin el `return fn()` del timeout: si no hay lock, fallar el turno. No robar el lock; escribir un pid y un timestamp que el dueño renueve. En `steer`, si a los 20 s sigue ocupada, devolver error y no crear la sesión nueva. Si `beginTurn` falla, fallar el shim.

### 7. Alta — En Windows, Ctrl+C y el shim no matan el árbol

`src/silka/hub.mjs:171-173`, `shims/agent-shim.mjs:541`, `shims/agent-shim.mjs:613`

agent-rack cancela con `taskkill /T` (`node_modules/agent-rack/dist/engine/process.js:10-16`). `silka hub` no: `child.kill()` sobre el proceso de agent-rack. En Windows eso no baja a los nietos (Codex, `cursor-agent` y el shell que hayan lanzado). El shim hace lo mismo con su hijo y no escucha `SIGBREAK`. `ensureHub` (`hub.mjs:137-143`) hace `spawn` detached y `unref`; si dos clientes arrancan a la vez y el token aún no existe, quedan dos procesos peleando el puerto. El hijo no tiene `error` handler: un spawn fallido se espera 20 s y se abandona.

Arreglo: copiar `signalProcessTree` (taskkill `/T` y `/F` a los 2 s). En `ensureHub`, un lock del puerto antes del spawn y matar el hijo si el token no aparece.

### 8. Media — El shim usa el Node de Cursor para lanzar los CLI

`shims/agent-shim.mjs:147-148`

Un binario `.js` se corre con `process.execPath`. `shims/logs/last-codex.log` muestra `C:\Users\<usuario>\AppData\Local\cursor-agent\versions\2026.11.19-f005e9d\node.EXE`. `connect.mjs:16-26` ya evita ese Node al registrar el MCP (`stableNode`), porque esa ruta desaparece al actualizar Cursor. El hub que quedó vivo sigue usándola en cada turno.

Arreglo: que `launcher` use `stableNode()` cuando el ejecutable sea un `.js`.

### 9. Media — El default de setup abre el directorio padre

`scripts/setup.mjs:111-113`

Si no hay `--workspace` ni config previa, `allowedWorkspaces` es `path.dirname(ROOT)`, el padre del repo. La config de esta máquina tiene `C:/Users/<usuario>/<carpeta-1>` y `C:/Users/<usuario>/<carpeta-2>`. Cualquier agente aceptado puede trabajar en todos esos proyectos, no solo en el repo. Las rutas con espacio (`Agent Rack`) van bien en el `spawn` por argv. `connect.mjs:36-47` cita el argumento si hay espacios, pero con `shell: true` en Windows un `&` o un `%` en la ruta no se escapa.

Arreglo: el default es el repo, no el padre. Documentar que ampliar es un flag explícito. En `quote`, escapar `%`, `&`, `^` y `"` cuando `shell` es true, o dejar `shell: false`.

### 10. Media — Rutas raras en el diff y procesos que el timeout no recoge

`src/silka/state.mjs:144-156`

`git status --porcelain=v1` no usa `-z`. Una ruta entre comillas o con ` -> ` se parte con `slice` y un replace de comillas; un escape de Git (`\343\200`) queda literal y el conflicto apunta al archivo equivocado. Un espacio suelto sí sobrevive.

El timeout de agent-rack mata el árbol del shim. El del bridge (`bridge.mjs:151-155`, tope 3600 s) solo corta la llamada MCP; no añade otra muerte. Correcto si agent-rack cumple. Si el shim ignora `SIGTERM`, el turno queda huérfano hasta el `taskkill` de agent-rack, que el handler del shim no replica.

Arreglo: `git status --porcelain=v1 -z` y partir por `\0`. En el shim, el mismo `taskkill /T` del hallazgo 7.

### 11. Media — UX del TUI: Enter puede irse a otra sesión

`src/silka/ui.mjs:381-388`, `src/silka/ui.mjs:44`, `src/silka/ui.mjs:248`, `src/silka/ui.mjs:448-493`

Cinco cambios, de mayor impacto:

1. Con texto en el compositor, ↑/↓ cambian la sesión y Enter envía ese texto a la sesión nueva. El borrador es global. Arreglo: si `draft` no está vacío, las flechas mueven el cursor del texto; Enter envía a la sesión que estaba seleccionada al empezar a escribir.
2. A 100 columnas el panel izquierdo queda en ~34 caracteres útiles (`leftWidth` 38). `▶`, id, agente, `QN!`, origen y tiempo no caben, y se corta justo el origen. Arreglo: fila 1 = icono + id + agente + marcas; fila 2 = origen + tiempo + prompt.
3. Si la terminal mide menos de 60 columnas, el layout se fuerza a 60 (`ui.mjs:44`) y el `truncate` se desborda. Arreglo: usar el ancho real y, por debajo de 80, apilar lista y actividad en vertical.
4. `n` crea la sesión en `process.cwd()` (`ui.mjs:248`), no en el workspace de la sesión elegida, y el asistente no pregunta carpeta. Un rechazo de `allowedWorkspaces` cabe en un banner de una línea. Arreglo: un paso de carpeta con el workspace de la sesión actual como default, y el error completo en el panel, no solo en el banner.
5. `c` confirma con `s` o `y`; el resto de la UI está en español. La ayuda (`?`) tapa la lista, así que `Q`, `N` y `!` se explican fuera de contexto. No hay atajo para vaciar la cola. Arreglo: confirmar con `s` (sí) y `n` (no), dejar la leyenda `Q` `N` `!` en el pie, y `x` para soltar la cola de la sesión elegida.

Estados vacíos y colores, en lo demás, se entienden: «Sin sesiones. n crea una.», hub rojo «● caído», iconos además del color. El pie de atajos coincide con el código.

### 12. Media — Duplicación, archivos grandes y `agent-rack/dist`

Imports privados, que un bump de `agent-rack@0.12.1` puede romper:

- `src/silka/hub.mjs:5-7` — `dist/cli/dashboard/remoteClient.js`, `dist/config/schema.js`, `dist/security/auth.js`
- `src/silka/bridge.mjs:6` — `dist/security/auth.js`

`ui.mjs` mide 689 líneas y mezcla red, conflicto, asistente y layout. `agent-shim.mjs` mide 645 y mezcla tres CLI, el estado y el log. Hay dos `originLabel` distintos (`origin.mjs:19` acorta el nombre; `format.mjs:184` lee `.from`). Hay dos `oneLine` (`state.mjs:104` y `format.mjs:49`), dos parsers de la marca `[silka …]` y dos mapas de verbos de herramientas (`agent-shim.mjs:213` y `format.mjs:64`). `scripts/setup.mjs:196-205` registra además `src/silka/mcp.mjs`, que solo expone `silka_notes`, en paralelo al bridge que ya las trae. Dos servidores pueden marcar las mismas notas como leídas.

Arreglo: un módulo `src/silka/rack.mjs` que concentre esos tres imports y falle con un mensaje si la forma no coincide. Partir `ui.mjs` en `ui-list.mjs`, `ui-wizard.mjs` y `ui-estado.mjs`. Unificar `originLabel`, `oneLine` y la marca. Dejar de registrar el MCP suelto de notas cuando el bridge está activo.

### 13. Media — No hay tests

`package.json` no tiene script `test`. Lo que hoy se puede cubrir con `node:test` sin lanzar un CLI ni el hub:

- `readSilkaMark` / `stampPrompt`: una sola marca, profundidad que no sube, `from` con salto de línea.
- `formatBlock`: máximo 15 líneas, rutas recortadas, sin `graphify-out/`, el prompt no puede suplantar el encabezado.
- `finishCursor` y `finishOpencode`: resultado recortado; sin `result` no se pega el stream.
- `cursorSpec`: con modo `plan` no aparece `--force`; documentar el caso `acceptEdits` cuando el hallazgo 1 se cierre.
- `withLock` + `beginTurn`/`finishTurn` en dos procesos sobre un temp dir: no se pierde una tarea.
- `appendNote` concurrente con `unreadNotes`: la nota nueva sigue en el archivo.
- `nestSessions`: ciclo de `parentSessionId` y `steeredFrom`.
- `parseArgs` y `quote`: ruta `Agent Rack` y un `&`.
- `isDelegatingTool` / `depthBlockMessage`: a profundidad 2 no queda `agent_session_send` si el hallazgo 2 se cierra; hasta entonces, un test que fije la lista blanca.

### 14. Media — Alguien nuevo no puede instalar, usar y desinstalar solo

Falta, en este orden:

- El README no dice que hay que dejar `silka hub` (o el bridge, que lo arranca) corriendo, ni cómo saber el puerto. El primer error útil es «corre: silka hub», pero el setup no arranca el hub ni crea un acceso directo.
- No hay `silka doctor` (Node, los tres CLI, login, config, hub vivo, workspaces).
- No hay `silka uninstall` ni `silka gc`. `disconnect` quita el MCP y no borra `~/.claude/skills/delegar`, `~/.config/silka/`, `silka-prompts.json` ni los `.silka/` de cada repo. `sessions.json`, `notes.jsonl` (las leídas se quedan), `tasks.json` y `decisions.jsonl` no tienen tope. agent-rack poda su memoria a los 120 minutos (`sessionRetentionMinutes`); Silka no.
- El TUI no elige workspace (hallazgo 11) y el wizard no muestra el modelo por defecto que ya está en la config.
- `mcp.mjs` y el bridge se registran los dos (hallazgo 12). Quien lee el README no sabe cuál responde `silka_notes`.

Arreglo: `silka gc` que borre orígenes y prompts de sesiones ya fuera del hub, notas leídas de más de 7 días y tareas `.silka` de más de 14 días. `silka uninstall` que haga `disconnect all`, borre el skill y, con `--purge`, `~/.config/silka`. Un párrafo de README: hub, TUI, puente, y «el default es este repo».

### 15. Baja — Errores que desaparecen y basura de ancho

`src/silka/ui.mjs:136` ignora el fallo de `refreshConflicts`. `agent-shim.mjs:594` ignora una línea que no es JSON. `bridge.mjs:257` sigue si `agent_session_list` falla y entonces la profundidad se queda en la variable de entorno, que Cursor y OpenCode no reenvían: la sesión hija nace en depth 0 (`bridge.mjs:105`). El pie del TUI y la ayuda no caben en 80 columnas y se cortan con `clip`.

Arreglo: un banner «estado no disponible» cuando el refresh falla. Si no se pudo listar el hub, no delegar. Mostrar el atajo corto en el pie y el largo solo en `?`.

## Top 8 para corregir ahora

1. Hallazgo 1 — quitar `--force` salvo política `danger-full-access`.
2. Hallazgo 2 — lista blanca de herramientas del bridge y `allowedWorkspaces` en `silka_*`.
3. Hallazgo 3 — el bloque de estado siempre lo escribe Silka, nunca el prompt.
4. Hallazgo 6 — locks de verdad en notas, orígenes, prompts y `.silka`; `steer` no abre otra sesión si la anterior sigue viva.
5. Hallazgo 4 — tope duro del texto que vuelve al manager, sin pegar el stream.
6. Hallazgo 5 — dejar de escribir el stream-json en `shims/logs/` dentro del repo.
7. Hallazgo 7 — `taskkill /T` al apagar el hub y al matar el shim.
8. Hallazgo 11.1 — las flechas no cambian de sesión mientras hay un borrador.
