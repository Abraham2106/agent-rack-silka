# Bugs del 2026-11-21: registro de repos, supervisor y arranque del hub

Encontrados al lanzar 9 tareas reales (comparación Composer 2.5 vs Hy4 flash) después de reiniciar el equipo.

## BUG-01 · Las pruebas llenaban el registro real de repos (y %TEMP%)

**Síntoma:** 9 tareas quedaron en `planificada` para siempre; el supervisor del hub no arrancaba ninguna.

**Causa:** `launch` registra el repo de la tarea en `<config>/task-repos.json` (fix `a025ac0`, para que los
supervisores vigilen repos externos). Las pruebas crean repos temporales y llaman a `launch`, pero no aislaban
`SILKA_CONFIG_DIR`, así que escribían en la configuración **real** del usuario. En pocas corridas de `npm test`
el registro llegó a **365 repos temporales**, y el supervisor, en cada ciclo, recorría todos con operaciones
de git síncronas: el ciclo nunca terminaba y nada arrancaba.

Además, las pruebas nunca borraban sus repos temporales: había **3425 carpetas `silka-*` en `%TEMP%` (~330 MB)**.

**Arreglo:**
- `test/setup-env.mjs`, cargado con `node --test --import`, da a cada proceso de prueba un `SILKA_CONFIG_DIR`
  temporal propio. Ninguna prueba toca `~/.config/silka`.
- Registro limpiado a mano (365 → 1) y carpetas temporales borradas.

**Pendiente:** que cada prueba borre su repo temporal al terminar (`t.after`), y que `listTaskRepos` ignore
repos dentro de `os.tmpdir()` salvo en pruebas, como segunda barrera.

## BUG-02 · El supervisor arrancaba sesiones de tareas descartadas

**Síntoma:** una sesión de Cursor (`b5addbd2`) siguió trabajando en el worktree de una tarea ya descartada.

**Causa:** `startPendingSessions` filtraba por `awaitingHubSession && worktreePath`, sin mirar el estado.
Una tarea descartada antes de arrancar conservaba `awaitingHubSession: true`.

**Arreglo:** solo arrancan tareas en `planificada` o `esperando_dependencias` (prueba RR-03).

## BUG-03 · El supervisor se tragaba sus errores y podía quedarse colgado

**Causa:** `catch {}` vacío en el ciclo; si una llamada al hub no respondía, el ciclo quedaba "en curso" para
siempre y los siguientes se saltaban sin aviso.

**Arreglo:** los errores van al log del hub (`<config>/hub.log`, nuevo; la consola del hub va minimizada); un
ciclo de más de 2 min se da por colgado y se reconecta; una tarea que no logra arrancar guarda `startError` y
no bloquea a las demás.

## BUG-04 · Varios hubs a la vez tras reiniciar el equipo

**Síntoma:** había 3 procesos `silka hub` vivos; solo uno tenía el puerto, pero los supervisores y
despachadores de **todos** corrían y competían (rompe el invariante de un solo escritor, I-6).

**Causa:** `ensureHub` no tiene candado: tras reiniciar, cada cliente (bridges de Claude/Codex/Cursor/OpenCode,
TUI) vio "no hay hub" a la vez y levantó el suyo.

**Arreglo (fase 1):** `src/silka/hub-owner.mjs`.
- Dueño registrado por puerto: `<config>/hub-<puerto>.owner.json` con pid y hora de inicio del proceso (contra
  reuso de pid). `startHub` lo reclama bajo candado **antes** de arrancar supervisores; si hay otro hub vivo,
  dice cuál (pid, desde cuándo, log) y no arranca nada. Al salir suelta el registro si sigue siendo suyo.
- Candado de arranque en `ensureHub`: bajo el mismo candado, solo un cliente decide lanzar el hub y deja una
  marca; los demás esperan a que aparezca. Si en 20 s el hub no se registra, otro cliente puede relanzarlo.
- Pruebas: `test/hub-owner.test.mjs` (segundo hub rechazado, pid muerto o reusado, 6 hubs a la vez → 1,
  6 clientes en `ensureHub` a la vez → 1 lanza, dueño vivo → se espera).
- **Prueba real:** 5 procesos llaman a `ensureHub` a la vez contra un puerto de prueba (18999, config temporal):
  queda **1** hub nuevo vivo y los 5 reciben el mismo agent-rack. Un `silka hub` manual con ese hub vivo
  responde "Ya hay un hub de Silka en el puerto 18999 (pid …); este no arranca" y sale con código 0.
  No se repitió el escenario original (reinicio del equipo con varios bridges).

## BUG-05 · `ECONNRESET` al lanzar varias tareas juntas

**Síntoma:** `silka.launch` de 9 tareas falla con "Se cortó la conexión con el hub durante callTool"; el
supervisor luego arranca las que faltan.

**Causa probable:** relacionada con BUG-04 (varios hubs) o con crear 9 worktrees de forma síncrona dentro del
bridge. **Pendiente:** reproducir con un solo hub.

## BUG-06 · Un agente escribió en el repo principal al desaparecer su worktree

**Síntoma:** aparecieron cambios sin revisar en el repo principal (`silka.d.ts`, `api-schema.mjs`,
`version.mjs`, `test/codemode.test.mjs`): el trabajo de la tarea del contrato, de una sesión huérfana.

**Causa:** al descartar la tarea `tk-3a2871db` se quitó su worktree, pero la carpeta quedó (la sesión la tenía
abierta) sin `.git`. La sesión siguió trabajando ahí; como los worktrees viven *dentro* del repo
(`.silka/worktrees/`), git subió de carpeta y encontró el repo principal, y el agente escribió en él.

**Arreglo:**
- Los worktrees viven **fuera del repo**: `%LOCALAPPDATA%\silka\wt\<repo>-<hash>\<id>` en Windows,
  `~/.local/share/silka/wt` en el resto (`src/silka/paths.mjs`, `worktreesBase`). Perder uno ya no cae en el
  repo principal. Lo mismo para los worktrees temporales de la integración. Enmienda en ADR-0005.
- `isValidWorktree`: antes de arrancar al agente, verificar o reanudarlo para reparar, Silka comprueba que el
  worktree siga siendo válido; si no, bloquea la tarea con el motivo y no ejecuta nada (FR-TK-11).
- Si una tarea se descarta mientras el hub crea su sesión, esa sesión se cancela en el acto.
- Pruebas WG-01…04. Comprobado en Windows con un worktree real y `node_modules` enlazado.

## BUG-07 · La ficha daba "pass" aunque el setup fallara

**Causa:** la ficha solo miraba la evidencia de verify y accept. Si el setup fallaba, verify ni corría y la ficha
salía `pass`: "lista para revisión" sin haber probado nada. Además, en verify la evidencia del verify
**sobrescribía** la del setup en vez de sumarse.

**Arreglo:** un setup fallido reprueba la ficha, y la evidencia de setup y verify se suma (WG-03, WG-07).

## Setup al crear el worktree

Antes, el setup corría solo antes de verify, así que el agente trabajaba sin dependencias. Ahora corre al crear el
worktree, antes de arrancar al agente (por defecto enlaza `node_modules` si el lockfile coincide con el del repo
principal; si no, instala). Si falla, el agente no arranca y la tarea queda en `verificacion_fallida` con el
error en su ficha. Verify solo repite el setup si cambió la huella de los lockfiles (raíz y un nivel, p. ej.
`sdk/`). Pruebas WG-05…07.

## Nota sobre el registro

La segunda barrera ya está: `registerTaskRepo` y `listTaskRepos` ignoran repos bajo `os.tmpdir()` salvo que la
configuración también sea temporal. Hacía falta porque los worktrees de los agentes, creados antes del
arreglo, corren `npm test` con el `package.json` viejo y volvieron a llenar el registro (321 entradas).

## BUG-08 · Ninguna tarea aislada podía arrancar tras mover los worktrees (lo introdujo el arreglo de BUG-06)

**Síntoma:** todas las tareas quedaban en `planificada`. agent-rack rechazaba crear la sesión del agente con
`Workspace path '…\silka\wt\…' is not within allowedWorkspaces`.

**Causa:** el arreglo de BUG-06 (`b3595a7`) movió los worktrees a `%LOCALAPPDATA%\silka\wt`, pero agent-rack
solo crea sesiones dentro de `allowedWorkspaces`, que tenía únicamente las carpetas del usuario. No se detectó
porque las pruebas usan un hub falso que no aplica esa lista, y la prueba manual en Windows no llegó a crear una
sesión de agente: se dio por comprobado sin cubrir el paso esencial.

**Arreglo:** al arrancar, el hub genera una config efectiva para agent-rack (en la carpeta de config de Silka,
sin tocar `agent-rack.config.json`) que agrega a `allowedWorkspaces` **solo** la carpeta de worktrees de Silka;
si ya estaba cubierta, no cambia nada (AW-01…04).

**Prueba real:** `npm run e2e:worktree` (`scripts/e2e-worktree-session.mjs`) crea un worktree en la carpeta de
Silka, arranca agent-rack real en otro puerto con la config efectiva y crea una sesión de agente de verdad. Con
`--sin-arreglo` reproduce el error original; con el arreglo la sesión se crea y termina.

## Regla para no repetir esto

Un cambio que toque cómo se crean, arrancan o verifican las tareas (worktrees, setup, supervisor, hub, config
de agent-rack) **no se da por comprobado** con las pruebas de hub falso. Antes de declararlo comprobado hay que
correr `npm run e2e:worktree`, que crea una sesión de agente real. Si no se corrió, se dice explícitamente.

## Lanzamiento de 9 tareas tras BUG-08 (4 a Cursor `composer-2.5`, 5 a OpenCode `opencode/hy4-flash-free`)

Orden de lo ocurrido, para tenerlo como referencia:

1. Primer lanzamiento (tope de 4 con `scripts/silka-launch.mjs --max 4`): las 9 tareas quedaron en `planificada`.
   El hub en marcha era anterior a `6d83db5` y seguía rechazando los worktrees por `allowedWorkspaces` (BUG-08).
   Un hub arrancado antes de un arreglo **no lo toma**: hay que reiniciarlo.
2. Se descartaron las 9 con `requestDiscard` (sus worktrees y ramas se borraron sin vaciar el `node_modules`
   del repo principal) y se cerró el hub viejo con el servidor de agent-rack que arrancó. Los `bridge` no se tocan.
3. Relanzadas con ids nuevos (`-2`) y sin tope de Silka (`--max 9`): 5 arrancaron y 4 no.

### BUG-09 · Una tarea sin cambios y con la sesión caída llegaba a la bandeja como "pass"

**Síntoma:** `ui-escenarios-2`, `iw-escenarios-2`, `rl-escenarios-2` y `tk-escenarios-2` pasaron a
`lista_para_revision`, riesgo bajo y verify en `pass`, con **0 archivos cambiados**. Las sesiones de OpenCode de
`rl` y `tk` duraron 9 s y 12 s y terminaron con `exit code 1`.

**Causa (confirmada en parte):** `npm test` pasa sobre un worktree sin tocar, y eso se toma como éxito. No se
comprueba que haya un diff ni que la sesión del agente terminara bien. De `ui` e `iw` no consta en `hub.log`
que su sesión llegara a arrancar; no se investigó más.

**Riesgo:** una ficha vacía parece lista para aprobar. Es lo que `reliability` dice evitar (el estado depende de
evidencia real, no de que el verify no falle). Detectado a mano, mirando `git status` de cada worktree.

Las 4 tareas se descartaron y se relanzaron (`-3`).

**Arreglo (fase 1 del plan de estabilización):**
- El supervisor guarda en la tarea cómo terminó la sesión (`sessionOutcome`: `completed`, `failed`,
  `cancelled` o `desaparecida` si ya no está en el hub) y un detalle.
- agent-rack marca `completed` aunque el agente termine con error: con un modelo inexistente, OpenCode deja
  `status: completed` y un evento `result` con `is_error: true` ("Model unavailable"). El supervisor mira la cola
  del log una vez al cerrar la sesión y, si el resultado es un error, la da por `failed`. Visto con agent-rack real.
- `finishAgentTurn` agrega evidencia `session` (ok solo si `completed`) y `diff` (sin archivos cambiados → falla,
  salvo `allowEmptyDiff: true` en la tarea). Si alguna falla, no se corren setup, verify ni accept.
- Con la sesión caída no hay reparación automática (la sesión no se reanuda sola): `verificacion_fallida`.
  Sin cambios y con la sesión bien, sí se le pide al agente que entregue (si le quedan reparaciones).
- `card.mjs`: `allOk` = todos los ítems de evidencia ok (antes solo setup, verify y accept).
- Hallazgo de la prueba real: el shim del agente escribe `.silka/tasks.json` en el worktree. En un repo que no
  ignora `.silka/`, la tarea vacía salía "pass" con ese archivo como cambio (y `git add -A` de la mezcla lo habría
  commiteado). Al crear el worktree, Silka agrega `.silka/` al `info/exclude` del repo (local, no versionado).
- Pruebas: `test/session-evidence.test.mjs` (failed, cancelled, desaparecida, `is_error`, sin cambios, `.silka/`,
  `allowEmptyDiff`, entrega buena, `allOk`).
- **Prueba real:** `npm run e2e:ciclo` (`scripts/e2e-task-cycle.mjs`, nuevo) arranca agent-rack real en otro
  puerto, lanza tareas en un repo desechable y corre el supervisor del hub con agentes reales (OpenCode,
  `hy4-flash-free`). Escenarios `entrega` (pass con session+diff+verify), `vacio` (fail por diff, verify sin
  correr) y `caida` (modelo inexistente → `failed`, fail, verify sin correr): los tres OK. `npm run e2e:worktree`
  también OK.

### BUG-10 · Tope de sesiones de agent-rack y reintentos cada ~2 s

**Síntoma:** `agent_session_create: Maximum concurrent sessions limit (5) reached`. Con 9 tareas, 4 esperaron y
el supervisor reintentó cada ~2 s por tarea; `hub.log` se llenó de líneas iguales durante unos 2 minutos.

**Causa:** el tope de 5 es de agent-rack, no de Silka, y quitar `maxConcurrentTasks` no lo cambia. El supervisor
no conoce ese tope: lo descubre fallando.

**Pendiente (no arreglado):** que el supervisor respete el tope de sesiones sin reintentar a ciegas (esperar con
retroceso o contar sesiones vivas) y que no repita el mismo error en el log. Para correr más de 5 a la vez hay
que subir el límite de agent-rack, decisión del usuario.

### Nota sobre BUG-05

Con un solo hub y el hub ya reiniciado, el lanzamiento de 9 tareas **no** dio `ECONNRESET`. Es una observación
de un solo intento, no una prueba de que BUG-05 esté resuelto.

### Cómo se enteró uno de que las tareas terminaron

`scripts/silka-launch.mjs` sale en cuanto las tareas arrancan, así que nadie recibe aviso al terminar. El estado
se mira con `silka task ls` y `silka review ls`. Pendiente decidir si el script debe esperar (`waitAll`).

## BUG-11 · El verify corría dentro del hub y lo congelaba

**Síntoma:** con un verify largo (`npm test`, ~3 min con setup) el hub dejaba de responder, se caía la conexión
del supervisor con agent-rack (`fetch failed`, `MCP error -32000: Connection closed`) y el vigilante de 2 min
podía darlo por colgado. Reproducido con `npm run e2e:ciclo`: un verify de 25 s dejaba el proceso del hub
quieto 25,8 s (pausa máxima del bucle de eventos) y aparecía `Connection closed`.

**Causa:** el supervisor del hub corría setup y verify con `spawnSync` dentro de su ciclo. Mientras tanto el
proceso no atendía nada: ni el SSE con agent-rack, ni los temporizadores, ni los demás supervisores.

**Arreglo:**
- `src/silka/tasks/jobs.mjs` (lanzador) y `job-worker.mjs` (proceso aparte): el supervisor del hub lanza
  `node job-worker.mjs <setup|verify> <repo> <tarea>` y sigue; el proceso corre el mismo código de antes y deja
  el resultado en el store de tareas. El ciclo dura milisegundos aunque el verify tarde minutos, así que el
  vigilante de 2 min (que mira la duración del ciclo) ya no lo ve.
- Un solo trabajo por tarea a la vez. El proceso deja su marca (`job: {pid, startedAt}`) en la tarea; tras
  reiniciar el hub, una tarea `verificando` sin ficha cuyo proceso ya no vive se relanza; si vive (mismo pid y
  hora de inicio), se espera.
- La sesión del agente se crea cuando el setup terminó (ciclo posterior). Un setup fallido deja la tarea en
  `verificacion_fallida` como antes.
- Fuera del hub (pruebas, `silka task verify`) todo sigue en línea, como antes.
- Hallazgo de paso: `readProcessStartMs` en Windows devolvía la hora corrida por el huso horario (6 h en
  UTC-6): el literal `[datetime]'1970-01-01Z'` se leía en hora local. Todo pid vivo parecía "reusado"; afectaba
  a la detección de candados rancios de `lock.mjs`. Ahora usa `DateTimeOffset`.
- Límite que sigue: cada comando de verify tiene un tope de 120 s (`verifyTimeoutMs`); un verify más largo falla
  por tiempo. No cambia con este arreglo.
- Pruebas: `test/jobs.test.mjs` (el ciclo no espera al verify ni al setup, setup fallido, verify interrumpido se
  relanza, marca con pid vivo/reusado, `startTaskSupervisor` sin pausas, hora de inicio real).
- **Prueba real:** `npm run e2e:ciclo` con los cuatro escenarios: pausa máxima del proceso 72 ms durante el
  verify de 25 s (antes 25 790 ms) y sin `Connection closed`. Con `--escenarios lento --verify-s 150` (verify de
  150 s en dos tramos, más que el vigilante de 2 min): ficha pass, pausa máxima 98 ms, sin aviso de ciclo colgado.

## El hub se cerraba solo al correr `silka hub` en una terminal (punto 4 del plan)

**Síntoma:** `node src/silka/cli.mjs hub` en una terminal salía enseguida, mientras agent-rack directo sí se
quedaba vivo.

**Reproducido (puerto de prueba 18999, config temporal):**
1. **Runtime viejo con pid reusado.** agent-rack deja `~/.config/agent-rack/runtime/sse-<puerto>.json` con su
   pid; tras un apagado brusco o un reinicio el archivo queda y ese pid pasa a ser de otro proceso. `hubStatus`
   solo miraba que el pid existiera: con el pid de `explorer.exe` en el archivo, `silka hub` imprimió
   "Hub ya está en marcha … (pid 16028)" y salió con código 0. agent-rack directo sí arrancaba (puerto libre).
2. **agent-rack huérfano.** Con un agent-rack vivo sin hub (arrancado directo, o su hub murió y él no),
   `silka hub` decía lo mismo y salía: nadie corría los supervisores.
3. **Otro hub vivo** (p. ej. el minimizado que levanta `ensureHub`): salía con una línea fácil de pasar por alto.
   Con BUG-04 ahora dice qué hub es (pid, desde cuándo, log).

En la terminal del panel, un hub sano en un puerto libre se quedó vivo más de 8 min; no se encontró otra causa.

**Arreglo:**
- `runtimeAlive`: el runtime cuenta como vivo solo si su proceso arrancó poco antes de escribirlo
  (`createdAt`); un pid reusado no cuenta. El chequeo de hora de inicio se cachea por pid + fecha.
- Si agent-rack está vivo y su proceso padre es un `silka hub` vivo (código anterior, sin registro de dueño),
  el hub nuevo no compite y lo dice. Si el padre murió, **adopta** ese agent-rack: arranca los supervisores,
  vigila su pid y, cuando termina, lo anota en `hub.log` y se cierra.
- El hub anota en `hub.log` por qué se cierra (agent-rack terminó, con código o señal).
- Pruebas: `test/hub-runtime.test.mjs`.
- **Prueba real:** con el runtime falso (pid de `explorer.exe`) el hub ahora arranca agent-rack y se queda
  vivo. Con un agent-rack huérfano arrancado directo, `silka hub` lo adopta ("agent-rack ya corría sin hub;
  se adopta"), se queda vivo y, al matar ese agent-rack, se cierra con el motivo en el log.

### BUG-10 · arreglo (fase 1)

- Al toparse con `Maximum concurrent sessions`, el hub deja de pedir sesiones (crear o reanudar para reparar)
  durante **30 s** y lo avisa **una sola vez** en `hub.log` ("agent-rack no da más sesiones …; se reintenta cada
  30 s"); cuando vuelve a haber cupo, lo dice ("vuelve a tener cupo"). Las tareas siguen en `planificada`.
- Cualquier otro error de arranque se anota una vez por tarea (igual que `startError`), no en cada ciclo.
- No cambia el tope: sigue siendo de agent-rack (`security.maxConcurrentSessions`, 5). Subirlo es decisión del
  usuario.
- Pruebas: `test/session-limit.test.mjs`.
- **Prueba real:** `node scripts/e2e-task-cycle.mjs --escenarios entrega,vacio --max-sesiones 1` (agent-rack real
  con tope 1, dos tareas): la segunda esperó, un solo aviso de tope en el log, luego "vuelve a tener cupo" y
  ambas terminaron con su ficha correcta.

## Reusar el id de una tarea descartada (punto 6 del plan)

**Síntoma:** relanzar con el id de una tarea descartada daba `E_CONFLICT: La tarea X ya existe.`, sin decir que
estaba descartada ni qué hacer (por eso los relanzamientos usaron `-2`, `-3`).

**Arreglo:**
- Mensaje claro: si la vieja está descartada, lo dice y propone otro id (`X-2`) o reemplazarla; si está viva,
  dice su estado y que solo una descartada se puede reemplazar. Un plan que repite un id también se rechaza con
  motivo.
- Reemplazo explícito: `silka task run --reemplazar` o `replaceDiscarded: true` en `silka.launch` (con
  `isolate: 'worktree'`). La vieja se conserva con su historial como `X~reemplazada-<n>` (`replacedBy: X`) y se
  limpian restos de su worktree o rama.
- Pruebas: `test/task-ids.test.mjs`. Prueba real: `e2e:ciclo --escenarios entrega` y `e2e:worktree` OK después
  del cambio (no ejercitan el reemplazo en sí; el reemplazo solo se probó con pruebas automáticas).
