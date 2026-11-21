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

**Pendiente (no arreglado):** candado de arranque en `ensureHub` (`withFileLock` sobre el runtime) y que
`startHub` salga si otro hub ya tiene el puerto o el lease, antes de arrancar supervisores.

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
- Los worktrees viven **fuera del repo**: `%LOCALAPPDATA%silkawt<repo>-<hash><id>` en Windows,
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
