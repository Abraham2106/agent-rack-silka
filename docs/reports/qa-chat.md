# QA: chat con agentes y envío inmediato

Commit: `9f4191d` (`silka-roadmap`). No se modificó código. El hub `127.0.0.1:8987` (pid 11084) quedó en marcha. Las pruebas de proceso fueron en `%TEMP%\silka-qa-chat` con un hub en el puerto **18991**, apagado al terminar. No se tocó `~/.codex` ni la config de Claude.

## Veredicto

La cola, el reanude de los tres agentes y el sandbox de Codex en `read-only` funcionan: dos mensajes llegan juntos y una sola vez, y el turno reanudado no puede escribir.

El criterio de interrumpir en menos de 3 s no se cumple: sin herramienta el shim tarda 3,5 s, y con una herramienta abierta 13,5 s. Esc no llega al TUI.

Si el hub se cae, la cola sigue en disco pero las sesiones no: al volver a arrancar no hay a quién entregar.

`npm test`: 21/21. `node --check` sobre 40 `.mjs`/`.js` fuera de `node_modules` y `sandbox`: `NODE_CHECK_OK`. `npm run smoke`: exit 0 (codex 27 s, opencode 8 s, cursor 22 s, los tres `isError=false`, archivo `hola "mundo" & 100%`). El sidecar avisó `EADDRINUSE` en el 8987 y siguió por stdio.

## Criterios (sección 5)

| Criterio | Resultado | Evidencia |
|---|---|---|
| Con un agente trabajando, Enter deja el mensaje en cola. Se ve y llega al terminar el turno aunque el TUI esté cerrado | PASA | Hub 18991, opencode `b48265b4` con `ping -n 12`. `silka send` dos veces, sin TUI: `en cola 7fdf010f …` y `en cola 83922dbb …`. `silka queue` los listó `pending`. Al cerrarse el turno la cola quedó vacía y el historial tiene un solo mensaje de usuario: `tú: anota ALFA` y `tú: anota BETA`. El TUI llama a la misma `sendToSession` (`src/silka/ui.mjs:256`). |
| Ctrl+Enter interrumpe en menos de 3 s y el agente responde con contexto, sin rehacer | FALLA | El contexto sí: opencode `6fb44fe0`, `enviado ya d79c2d2e`. El reanude (`-s ses_e0432a63…`) respondió `YA-AHORA — sí, ya había empezado el ping (… 20/20…). No lo relancé`. El tiempo no: shim falso sin herramienta, 3499 ms desde el fichero de interrupción hasta el exit; con `tool_call` abierto, 13459 ms. En vivo, la nota es `01:51:42.575Z` y el evento `interrupt` es `01:51:45.955Z` (3,4 s). El tope de la herramienta es 10 s (`src/silka/interrupt.mjs:9`) y el `taskkill` forzado espera 2 s (`shims/agent-shim.mjs:796`). |
| Igual en Codex, Cursor y OpenCode, y en sesiones lanzadas por Claude | PASA | OpenCode: `-s ses_…` en `last-opencode.log`. Cursor `83d13600`, modelo `grok-4.7-medium-fast`, tras `completed`: `enviado f35fbacd` y el log lleva `--resume 37461b1d-5bef-4dd8-936f-db8b10716e72`. Codex: el mismo `thread_id` `01a1fbcb-…` en el segundo turno. Claude, por el bridge del 18991: `silka_send` de un cliente `claude` respondió `en cola c39be978`. Un cliente `opencode` sobre esa sesión ajena: `silka_send no puede usarse sobre sesiones ajenas.` `isError=true`. |
| Varios mensajes en cola llegan juntos, en orden, sin perderse ni duplicarse | PASA | Historial de `b48265b4`, un solo evento `user`: `tú: anota ALFA` y debajo `tú: anota BETA`. La cola quedó `messages: []` y `delivered` con esos dos id, una vez cada uno. El resumen del agente: `Anotado: ALFA y BETA (en ese orden).` |
| Claude ve las inserciones en `silka_notes` y `silka_state` | PASA | `%TEMP%\…\hub\silka\notes.jsonl`: `tú → opencode b48265b4: anota ALFA` y `… BETA`, `kind: insertion`. El prompt del turno de Cursor las trae en el bloque de estado: `tú → opencode b48265b4: anota ALFA`. El skill lo dice en `skills/delegar/SKILL.md:57-64`. |
| El chat se reconstruye igual al cerrar y abrir el TUI | PASA | `npm test`: `el historial se redacta, se guarda en jsonl y se reconstruye igual al reabrir`. En el pty, cada apertura del TUI volvió a pintar el mismo historial del hub 8987 (herramientas y `── en cola ──`). El jsonl vive en `~/.config/silka/transcripts`, fuera del repo. |

## Riesgos (sección 6)

| # | Riesgo | Estado | Evidencia |
|---|---|---|---|
| 1 | Paso a medias | MITIGADO | Con la herramienta abierta el shim no mata al instante: 13,5 s frente a 3,5 s en vacío (diferencia ≈ el tope de 10 s, `interrupt.mjs:9`, `shims/agent-shim.mjs:791`). El reanude real incluye `Revisa el estado de los archivos antes de seguir…` (`src/silka/queue.mjs:59`). Al interrumpir, `closeTurn` pasa por `finishTurn` (`shims/agent-shim.mjs:688`, `src/silka/state.mjs:364`). |
| 2 | Carreras | MITIGADO | Dos mensajes, una entrega (`delivered` con dos id, sin repetir). `npm test`: `la cola persiste, agrupa y se entrega una sola vez` y `la orden de interrupción, la entrega única`. Cursor ya `completed`: `send --now` imprimió `enviado`, no `enviado ya` (`commands.mjs:163`). |
| 3 | Dependencia de agent-rack | MITIGADO | `package.json:26` fija `agent-rack` `0.12.1`. Reanudar después de `completed` funcionó en Cursor (`--resume`) y en Codex (mismo thread). |
| 4 | Reanudar falla en algún agente | PARCIAL | Los tres reanudaron en esta pasada. Si `sendInput` falla, el despachador solo escribe en stderr y devuelve el lote a `pending` (`src/silka/dispatch.mjs:32-36`). No hay aviso en el chat ni caída explícita a “solo cola”. |
| 5 | Ctrl+Enter no se detecta | MITIGADO | Pty 120×35, `CI` quitado. Alt+Enter (`\x1b\r`), kitty (`\x1b[13;5u`) y modifyOtherKeys (`\x1b[27;5;13~`), con la caja vacía, pintaron `El mensaje está vacío.` La ayuda y el pie muestran `alt+enter`. |
| 6 | Costo en tokens | MITIGADO | La cabecera del chat dice `0 interrupciones` (`src/silka/ui/chat.mjs:101-103`). El historial de `6fb44fe0` tiene `kind: interrupt`. |
| 7 | Instrucciones contradictorias | MITIGADO | Inserciones en `notes.jsonl` y en el bloque que el siguiente agente recibió. `skills/delegar/SKILL.md:64`: no contradecir una inserción `tú → agente` sin preguntar. |
| 8 | El hub tiene estado | PARCIAL | `GAMMA` (`c39be978`) seguía `pending` en disco tras matar el 18991. Al arrancar otra vez: `No hay sesiones.` y el mismo `pending`. La cola sobrevive; las sesiones de agent-rack no, y el despachador no tiene a quién entregar (`src/silka/dispatch.mjs:14-21`). |
| 9 | Datos sensibles | PARCIAL | El historial queda fuera del repo (`src/silka/paths.mjs:6`). Un prompt con `sk-FAKE1234567890TOKEN` salió como `[redactado]` y el secreto no está en el jsonl. No hay retención ni `silka clean`: `src/silka/cli.mjs` no registra ese comando. |
| 10 | Nivel A inestable | MITIGADO | No hay envío en vivo. Solo interrupción y cola (decisión 7.4). |
| 11 | TUI lento | PARCIAL | Medido hoy, pty 120×35, hub 8987 (20 sesiones): primer frame a los **2075 ms** con `0 sesiones`; `20 sesiones` a los **3424 ms**. No reproduje 15 s. La lista no se pinta hasta el final de `tick` (`src/silka/ui.mjs:215`), después de `refreshConflicts` (`ui.mjs:179`, `state.mjs:326`) y `workspaceReport` (`state.mjs:474`). Cada uno lanza `git` con `spawnSync` (`state.mjs:96-97`, tope 20 s): `repoInfo` son 3 procesos, `formatBlock` (`state.mjs:207`) los repite. El render virtual (`ui/chat.mjs:84`) no adelanta esa espera. |

## Decisiones (sección 7)

Enter encola: `silka send` sin `--now` imprimió `en cola` con el agente en `running`. Ctrl+Enter y Alt+Enter se tratan como enviar ya: en el pty los tres acordes (Alt, kitty, modifyOtherKeys) disparan el camino de envío inmediato. Claude puede `silka_send` con y sin `now`; sin `now` quedó `en cola`. Un cliente `opencode` no puede usarlo sobre una sesión cuyo origen no es él.

## Codex, resume y sandbox

Primer turno: `node shims/agent-shim.mjs codex exec --json --skip-git-repo-check --sandbox read-only`, thread `01a1fbcb-0c6a-7ea1-8217-d42f44340fd0`. Segundo turno, los mismos args con `resume` delante. El log del turno reanudado:

`exec resume --json --skip-git-repo-check -c sandbox_mode="read-only" 01a1fbcb-…`

No aparece `--sandbox`. El agente respondió `BLOQUEADO`. `escrito-ro.txt` no se creó.

## TUI (node-pty, 120×35)

Con `CI=1` (el valor de este proceso) Ink no es interactivo y no pinta. Las pruebas de teclas van con `CI` quitado. Entra en la pantalla alternativa (`\x1b[?1049h`). `q` desde la lista escribe `\x1b[?1049l`. El frame más alto contado en el pty fue de 35 líneas, igual al alto, sin pasarse.

| Tecla | Qué hizo |
|---|---|
| `?` | Abre la ayuda (`Ayuda abierta. esc cierra.` y el texto de atajos). |
| Esc | No cierra la ayuda, no cierra el estado y no borra el borrador: tras Esc, el compositor seguía en `› x`. |
| `q` en la ayuda | Vuelve a la lista. No sale. |
| `q` en la lista | Sale (`?1049l`). |
| `e` | Abre el estado (`Estado del proyecto · e o esc vuelve`). |
| Ctrl+B | Oculta la lista: la cabecera pasa a `20 sesiones   chat` y el chat ocupa el ancho. |
| Enter (caja vacía) | No encola. La cola siguió en `vacía`. |
| Alt+Enter, Ctrl+Enter kitty y modifyOtherKeys | Con la caja vacía, los tres pintan `El mensaje está vacío.` No encolan. |
| ↑ en la primera fila | No cambia la selección (no hubo frame nuevo). |
| PgUp / PgDn | Hay frame nuevo. No pude distinguir un salto de historial: la ventana seguía mostrando el final. |

## Hallazgos

1. **Alta.** Interrumpir pasa de 3 s aunque no haya herramienta. `shims/agent-shim.mjs:796` espera 2 s antes del `taskkill` forzado; si hay herramienta, se suma el tope de `src/silka/interrupt.mjs:9`. Arreglo: en Windows matar el árbol con `/F` enseguida, y bajar el tope si el criterio de 3 s manda sobre los 10 s.
2. **Alta.** Esc no llega a Ink. `src/silka/keys.mjs:85` retiene un `\x1b` suelto (`HOLD_RE`, línea 6) sin plazo, a la espera de un CSI. Arreglo: si lo retenido es solo Esc, soltarlo a los ~40 ms.
3. **Media.** La lista espera a `git` antes de pintarse (`src/silka/ui.mjs:177-215`). Arreglo: `setSessions` en cuanto responde `listSessions`; conflictos e informe del workspace en el tick siguiente.
4. **Media.** Reiniciar el hub vacía las sesiones y deja la cola huérfana (`src/silka/dispatch.mjs:14-21`). `GAMMA` sigue `pending`. Arreglo: al arrancar, si no hay sesión para ese id, dejar el mensaje y decirlo en el log y en el chat la próxima vez que exista; o persistir las sesiones.
5. **Media.** Un `sendInput` fallido no se ve en el chat (`src/silka/dispatch.mjs:34`). Arreglo: un evento `interrupt` o `status` en el historial con el error, y seguir en cola.
6. **Baja.** No existe `silka clean` ni una retención del historial. Arreglo: un comando que borre `transcripts/` más viejos que un número de días, leído de la config.
7. **Baja.** Con la ayuda abierta, `q` no sale (`src/silka/ui.mjs:436`) aunque el pie sigue diciendo `q salir`. Arreglo: en la ayuda, `q` sale y Esc cierra, como dice el pie.

## Top 5 para corregir

1. La interrupción tarda 3,5 s en vacío y 13,5 s con herramienta (`shims/agent-shim.mjs:796`, `src/silka/interrupt.mjs:9`).
2. Esc se queda retenido y no borra ni cierra (`src/silka/keys.mjs:85`).
3. El TUI muestra `0 sesiones` hasta que terminan los `git` (`src/silka/ui.mjs:215`).
4. Al reiniciar el hub la cola no se entrega (`src/silka/dispatch.mjs:14`).
5. Un fallo al reanudar solo sale por stderr (`src/silka/dispatch.mjs:34`).
