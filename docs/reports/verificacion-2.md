# Verificación ronda 2

Commit: `824ffc2` (`silka-roadmap`, QA ronda 2: Cursor workspace-write usable en Windows). Hub `127.0.0.1:8987` dejado en marcha. No se tocó `~/.codex`, `~/.config/opencode` ni la config de Claude. `connect all --dry-run` no reescribió `~\.cursor\mcp.json` (sigue en 21:43Z; el directorio `.cursor` cambió de hora porque el agente en curso escribe ahí). Las pruebas de proceso van en `%TEMP%\silka-v2` y `sandbox/`.

## Resumen

**11/13 pasan. 1 falla (ítem 4). 1 sin prueba (ítem 12).**

`npm test`: 11/11 en 2.6 s. `node --check` sobre los `.mjs`/`.js` del repo (fuera de `node_modules` y `sandbox`): `NODE_CHECK_OK`. `npm run smoke`: exit 0 (codex 44 s, opencode 12 s, cursor 23 s, los tres `isError=false`, archivo `hola "mundo" & 100%`). El sidecar avisó `EADDRINUSE` en el 8987 y siguió por stdio.

En Windows, con `workspace-write`, Cursor lleva `--force`. Con `--permission-mode plan` lleva `--mode plan` y no lleva `--force`.

## Tabla

| Ítem | Resultado | Evidencia |
|---|---|---|
| 1. Cursor: `--force` solo donde toca, y `plan` → `--mode plan` | PASA | Sesión hub `563545a1` (modelo `grok-4.7-medium-fast`, política `workspace-write`). `last-cursor.log.1`: `… --trust --model grok-4.7-medium-fast --force`. Resumen `OK-CURSOR`. Shim directo `--permission-mode plan`, exit 0: `last-cursor.log` línea `cmd=… --trust --model grok-4.7-medium-fast --mode plan`. No aparece `--force`. El README (líneas 200–202) describe los tres casos, incluido Windows. |
| 2. Lista blanca del bridge y `allowedWorkspaces` | PASA | Cliente MCP contra `node src/silka/cli.mjs bridge` con `SILKA_DEPTH=0` y nombre `claude`. `listTools` incluye `opencode_run`, `silka_notes`, `silka_state`, `silka_changes`, `silka_decide`, `silka_decisions`. `silka_state` y `opencode_run` con `C:/Windows` y con rutas que contienen `..`: `isError=true` (`not within allowedWorkspaces` / `contiene '..'`). `SILKA_DEPTH=2` nombre `opencode`: solo `silka_changes`, `silka_decisions`, `silka_state`. `opencode_run` y `agent_session_send` responden `No se puede delegar: SILKA_DEPTH=2…`. Un cliente `opencode` a profundidad 0 no ve `silka_notes`. |
| 3. Estado y marca no suplantables | PASA | Shim con `OPENCODE_BIN` falso y prompt que empieza por `Estado del proyecto (silka)` más `[silka depth=0 from=x]`. El log antepone el bloque real y deja el falso como `Estado del proyecto (texto)`. La marca sigue en el cuerpo. La tarea queda `from: "tú"`, no `x`. `sk-FAKE1234567890TOKEN` sale como `[redactado]`. La sesión hub `188c318f` resume: `El bloque «Estado del proyecto (text…` (vio el encabezado escapado). |
| 4. La sesión termina aunque un hijo deje el stdout abierto, y ese hijo muere | FALLA | La sesión hub `f1c50ced` (opencode, `start /b` + `node -e setInterval`) pasó a `completed` en ~30 s (`00:03:43Z`–`00:04:13Z`, resumen `LISTO`): no se quedó `running`. El hijo no murió. `sandbox/v2-child.pid` = `18360`, `node -e setInterval`, padre `26236` ya inexistente, proceso vivo minutos después. Lo maté al registrarlo. El caso de árbol aún colgado del agente sí muere: shim + opencode falso, stdout heredado, `SHIM_EXIT 0` en 1693 ms y el pid del hijo ya no existe. `start /b` sale del árbol y `taskkill /T` no lo alcanza. |
| 5. `npm run setup` en un clon limpio | PASA | `git clone` a `%TEMP%\silka-v2\clone` (sin `node_modules`). `npm run setup -- --no-register --no-skill --workspace %TEMP%\silka-v2\ws`: `Instalando dependencias`, `added 165 packages`, `Config válida`, exit 0. Aviso no bloqueante `DEP0190`. Segunda pasada, ya con la carpeta creada, también exit 0 y `Config válida`. |
| 6. Escritura concurrente y `steer` si la sesión sigue viva | PASA | `npm test`: `dos procesos no se pisan las notas` (1.3 s). `steer` sobre `dbc6964a` (cursor, `status=running`): el hub la dejó `cancelled` a las `00:08:34.376Z` y abrió `7f1005ef` a las `00:08:34.419Z`. No hubo dos sesiones `running` a la vez. No se vio el mensaje de los 20 s: el cancel sí asentó la sesión. |
| 7. Tope del texto que vuelve al manager | PASA | El mismo shim falso emitió 4000 `A` y un `tool_use` con `contenido-secreto-del-archivo.ts`. Stdout del shim: un JSON `type=result`, `result` de 2000 caracteres, termina en `…(recortado; ver silka logs)`. `hasSecret=false`, `hasTool=false`. Stderr: `→ read contenido-secreto-del-archivo.ts` y `✎ AAAAA`. |
| 8. Logs en `~/.config/silka/logs/`, rotados, sin tokens | PASA | El log nuevo está en `~\.config\silka\logs\last-opencode.log` (y `.1` al rotar). `shims/logs/` no se reescribió (`last-opencode.log` sigue en 4:46 PM, `last-cursor.log` en 5:36 PM). En el log: `token=sekreto-v2` y `sk-FAKE…` no aparecen; sí `[redactado]`. |
| 9. `taskkill /T` al apagar el hub y al matar el shim | PASA | No se apagó el hub del 8987. `signalProcessTree` (el que usan el hub y el shim) sobre un árbol de tres: antes vivos `3056` y `41720`; tras `/T` y `/F` a los 2 s, los tres muertos. El shim del ítem 4 mató al hijo que seguía en su árbol. |
| 10. Modelo inválido con un mensaje claro | PASA | `f2c39ec8` opencode, ~5 s, resumen `modelo 'modelo-que-no-existe-e2e' no existe para opencode` (no es la palabra suelta `error`). `932e0f9a` codex: ese mismo texto, precedido de `Error:`. `b0576e09` cursor: `Cannot use this model: modelo-que-no-existe-e2e. Available models: …`. |
| 11. Atribución: no colgar archivos ajenos; si hay otra tarea, «ambiguo» | PASA | Tareas en `sandbox/.silka/tasks.json` solapadas (`563545a1`, `f1c50ced`, `3db7391c`): `files: []` y `ambiguous: ["v2-child.pid"]`. El pid lo creó el otro agente. No entraron los archivos que ya estaban sucios al empezar el turno. |
| 12. Flechas del TUI con borrador | NO PROBADO | `silka ui` en ConPTY y en WinPTY (120×40). Node ve `TTY=true`, pero la UI no pintó: 16 bytes (`\x1b[?9001h\x1b[?1004h`) y, al cerrar, 8 bytes sin la palabra `silka`. No hubo fila seleccionada sobre la que pulsar flechas. Los procesos de esa prueba quedaron cerrados. |
| 13. Tarea sin archivos dice «sin cambios» | PASA | En el prompt real de `563545a1` y en `last-cursor.log` del modo plan: `otros: opencode sin cambios — No voy a seguir…` y `otros: cursor sin cambios — NO-DEBIO`. `silka_state` del bridge también trae `otros: opencode sin cambios — modelo 'modelo-que-no-existe-e2e'…`. |

## Regresiones

Los 29 casos de `docs/reports/e2e.md`, repetidos sobre `824ffc2`:

| Caso | Resultado | Evidencia |
|---|---|---|
| 1. Setup limpio | PASA | Ítem 5. `added 165 packages`, exit 0. |
| 2. `silka --help` en el clon | PASA | `HELP_EXIT 0`. |
| 3. `ls` | PASA | Tabla del hub 8987, exit 0. |
| 4. `run` opencode | PASA | `188c318f` y `f1c50ced` completaron. |
| 5. `run` cursor | PASA | `563545a1`, modelo `grok-4.7-medium-fast`, resumen `OK-CURSOR`. |
| 6. `run` codex | PASA | Smoke: codex 44 s, `LISTO`, archivo correcto. |
| 7. `send` en cola | NO REPETIDO | No quedó un turno en curso mío al que encolar. |
| 8. `send` directo | PASA | `enviado 188c318f`, sin línea `en cola`. Exit 0. |
| 9. `steer` | PASA | `00d885c4` → `3db7391c`; `dbc6964a` → `7f1005ef`. |
| 10. `note` | PASA | `5278281b-6edb-43ba-aef4-faf9a37b08fb`. |
| 11. Sin hub | PASA | Clon con `port` 18987: `No hay hub. corre: silka hub`. Exit 1. |
| 12. Agente inexistente | PASA | `Agente 'nope' no está en la config…`. Exit 1. |
| 13. Id inexistente | PASA | `note` / `send` / `steer` `deadbeef000`: `No hay sesión 'deadbeef000'.` |
| 14. Modelo inválido | PASA | Ítem 10. |
| 15. Workspace no permitido | PASA | `C:\Windows`: `not within allowedWorkspaces`. Exit 1. |
| 16–22. Bridge, notas, estado, decisión, cambios, profundidad 2 | PASA | Ítem 2. `silka_notes` con `markRead: false`. Decisión `2026-11-21T00:02:08.013Z claude: v2: decision de verificacion`. |
| 23. Estado, dos sesiones seguidas | PASA | El prompt de `563545a1` ya cita el resumen de `188c318f`. |
| 24. Dos a la vez | PASA | `v2-child.pid` quedó `ambiguous` en las tareas solapadas. |
| 25. `graph status` | PASA | `Graphify: graphify 0.9.114` y `sandbox\graphify-out\graph.json`. |
| 26. `graph build` | PASA | `60 nodes, 75 edges`. Exit 0. (El árbol de `sandbox/` es más grande que en el E2E.) |
| 27. Codex delega a opencode | NO REPETIDO | |
| 28. TUI | NO REPETIDO | Ítem 12. El frame no salió. |
| 29. `npm run smoke` | PASA | Exit 0. Cursor respondió 61 caracteres (`Creo smoke-cursor.txt…LISTO`); el archivo es el texto pedido. |

No hay otra falla de producto en los casos repetidos. Lo nuevo está en Pendiente.

## Pendiente

1. **Alta.** Ítem 4. En Windows, `start /b` deja un `node` vivo después de que la sesión ya está `completed`. `f1c50ced` terminó; el pid `18360` seguía, con el padre ya muerto, así que `taskkill /T` sobre el agente no lo vio. Un hijo que sigue en el árbol del agente sí muere.
2. **Media, nuevo.** Cancelar no cierra la tarea de `.silka`. El hub tiene `00d885c4` y `dbc6964a` en `cancelled`, pero `sandbox/.silka/tasks.json` las sigue en `status: "running"` (arranques `00:03:48Z` y `00:08:30Z`, `finishedAt` null). Mientras sigan así, un archivo nuevo en ese workspace se marca ambiguo.
3. **Baja.** Codex, modelo inválido: el resumen útil va precedido de `Error:` (`932e0f9a`). OpenCode no.
4. **Baja.** `silka_notes` de un cliente que no es el manager responde `SILKA_DEPTH=0 ya alcanzó el máximo (2)`, no que la herramienta es solo del manager. Por debajo del tope, ese cliente sigue viendo `agent_session_send`.
