# Verificación ronda 1

Commit: `7144472` (`silka-roadmap`, incluye `eb54790`). Hub `127.0.0.1:8987` dejado en marcha. No se tocó `~/.codex`, `~/.cursor`, `~/.config/opencode` ni la config de Claude. `connect` no se ejecutó.

## Resumen

**5/13 con evidencia de una corrida real del código ya corregido. 0 fallas confirmadas. 8 ítems sin prueba.**

Esta sesión de Cursor (política `workspace-write`) no pudo lanzar comandos. `ls` salió 0. `node --version`, `npm test`, `git` y un subagente devolvieron `Rejected:` al instante, también al pedir aprobación. La allowlist de `~/.cursor/cli-config.json` es solo `Shell(ls)`. El log nuevo del shim no lleva `--force`, así que el CLI ya no aprueba el shell solo.

La evidencia de los 5 ítems que pasan es de la corrida inmediatamente anterior sobre el mismo árbol (setup 23:31Z, modelo inválido 23:34Z, smoke 23:34–23:36Z), más el log que esa corrida dejó en `~/.config/silka/logs/`. Esta sesión no pudo repetirla.

`npm test`, `node --check` y un `npm run smoke` propio no se ejecutaron. El smoke de las 23:34Z sí terminó en 0 (ver regresiones).

No arranqué hubs, TUIs ni servidores. No pude cerrar el `node sandbox/e2e-tui-phases.mjs` que ya figuraba en marcha desde las 22:47Z (pid 29352 en el terminal de esa prueba): hace falta un comando distinto de `ls`.

## Tabla

| Ítem | Resultado | Evidencia |
|---|---|---|
| 1. Cursor sin `--force` salvo `danger-full-access` | PASA | `~/.config/silka/logs/last-cursor.log` (5:36 PM), cwd `sandbox`, política del config `workspace-write`. Línea de comando: `cursor-agent … -p --output-format stream-json --stream-partial-output --trust <prompt>`. No aparece `--force`. El README (líneas 200–202) documenta `read-only`, `workspace-write` y `danger-full-access`. No se lanzó un turno `--permission-mode plan`. |
| 2. Lista blanca del bridge y `allowedWorkspaces` | NO PROBADO | Hace falta un cliente MCP. El shell no corre `node`. |
| 3. Estado y marca no suplantables | NO PROBADO | No se envió un prompt con encabezado falso ni `[silka depth=0 from=x]`. |
| 4. La sesión termina aunque un hijo deje el stdout abierto, y ese hijo muere | NO PROBADO | No se lanzó opencode ni `ping` / `setInterval`. |
| 5. `npm run setup` en un árbol sin `node_modules` | PASA | Terminal de `npm run setup -- --no-register --no-skill --workspace %TEMP%\silka-e2e-ws` sobre una copia sin `node_modules` ni `.git`. Salida: `Instalando dependencias`, `added 165 packages`, `Config válida`, `SETUP_EXIT 0`. Aviso no bloqueante: `DEP0190` (`shell: true`). No es un `git clone`; es el mismo fallo de importar `agent-rack` antes de instalar. |
| 6. Escritura concurrente y `steer` si la sesión sigue viva | NO PROBADO | No se corrió `npm test` ni dos escrituras a la vez. |
| 7. Tope del texto que vuelve al manager, sin pegar el stream | NO PROBADO | El smoke devolvió `LISTO` (5–68 caracteres). No hubo un resultado largo. |
| 8. Logs crudos en `~/.config/silka/logs/`, rotados, fuera del repo | PASA | `ls ~/.config/silka/logs`: `last-codex.log` 3138 B, `last-cursor.log` 9670 B, `last-opencode.log` 5764 B (5:35–5:36 PM) y `last-opencode.log.1` 1283 B (5:34 PM). El smoke de las 5:35 no reescribió `shims/logs/last-opencode.log` ni `last-codex.log` (siguen en 4:46 PM). Queda `shims/logs/last-cursor.log` de 3.1 MB con `--force`: es la sesión del corrector, arrancada antes del arreglo (`@ 89652a1`). No se plantó un token para ver la redacción. |
| 9. `taskkill /T` al apagar el hub y al matar el shim | NO PROBADO | El hub del 8987 no se tocó. No se canceló ninguna sesión. |
| 10. Modelo inválido con un mensaje claro | PASA | `last-opencode.log.1`: `opencode.exe run --format json -m modelo-que-no-existe-e2e`, `exit=1`, stdout `Invalid model reference: modelo-que-no-existe-e2e`. El bloque de estado de las sesiones siguientes guarda `otros: opencode sin cambios — modelo 'modelo-que-no-existe-e2e' no existe par…`, no la palabra `error`. No se repitió para cursor ni codex. |
| 11. Atribución: no colgar archivos ajenos; si hay otra tarea, «ambiguo» | NO PROBADO | No se creó un archivo en paralelo a un turno. |
| 12. Flechas del TUI con borrador | NO PROBADO | `silka ui` no se abrió. |
| 13. Tarea sin archivos dice «sin cambios» | PASA | La misma línea del estado: `otros: opencode sin cambios — modelo 'modelo-que-no-existe-e2e' no existe par…`. |

## Regresiones

Ninguna falla nueva en lo que hay salida. El resto de los 29 casos de `docs/reports/e2e.md` no se repitió.

| Caso E2E | Resultado | Evidencia |
|---|---|---|
| 1. Setup limpio | PASA | `SETUP_EXIT 0` (tabla, ítem 5). |
| 14. Modelo inválido | PASA | Mensaje `modelo 'modelo-que-no-existe-e2e' no existe…` en el estado (ítem 10). |
| 29. `npm run smoke` | PASA | Terminal 23:34:43Z–23:36:19Z, exit 0. Codex 32 s, opencode 17 s, cursor 42 s, los tres `isError=false` y archivo `hola "mundo" & 100%`. Sidecar: `EADDRINUSE` en el 8987 y siguió por stdio. Los tres `smoke-*.txt` en `sandbox/` tienen ese texto. |
| 2–13, 15–28 | NO REPETIDO | El shell de esta sesión no ejecuta `npm run silka` ni `node`. |

## Pendiente para la ronda 2

1. **Alta, nuevo.** Cursor con `workspace-write` no pide confirmación para el shell: lo rechaza. En esta sesión `ls` funciona y cualquier otro comando (`node --version`, `npm test`) responde `Rejected:`, también con la tarjeta de aprobación. La allowlist local es `Shell(ls)`. Sin `--force`, un Cursor lanzado por el hub no puede correr tests, git ni el caso del proceso hijo. Por eso quedaron sin prueba los ítems 2, 3, 4, 6, 7, 9, 11 y 12, y 26 casos de regresión.
