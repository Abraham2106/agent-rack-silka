# Proposal

## Why

Un worktree recién creado no siempre "arranca": le faltan los `.env*` que git no versiona, no tiene puertos
propios para levantar un servidor de desarrollo sin chocar con otras tareas, y no hay forma de declarar cómo se
prepara, se levanta y se cierra el proyecto. Conductor resuelve esto con recetas por workspace; Silka puede
hacerlo en Windows, versionado en el repo.

## What Changes

- Archivo `silka.json` en la raíz del repo (versionado) con `setup`, `run` (comandos con nombre), `archive`,
  `copy`, `ports`, `runMode` (`concurrent` o `exclusive`) y `shell` (`pwsh`, `cmd` o `bash`), con variantes por
  sistema.
- Copia al worktree los archivos que git no versiona según `copy` y `.worktreeinclude`, respetando la lista de
  denegación de secretos de `agent-containment`.
- Rango de puertos por tarea (por defecto 10) y variables de entorno estándar `SILKA_PORT`,
  `SILKA_WORKSPACE_PATH`, `SILKA_ROOT_PATH`, `SILKA_WORKSPACE_NAME`, `SILKA_TASK_ID` y `SILKA_DEFAULT_BRANCH`.
- `run`, `stop` y `archive` de una tarea, con cierre del árbol de procesos en Windows antes de borrar el worktree.

**Fuera de alcance:** interfaz gráfica, previsualización del servidor en el TUI y flujo de PR.

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `isolated-tasks`: el worktree se prepara con una receta versionada (copia, puertos, entorno) y se puede
  levantar, detener y cerrar.

## Impact

- `src/silka/tasks/` (setup, puertos, worktree, cierre), `src/silka/proc.mjs` (árbol de procesos), Code Mode
  (`silka.workspace.*`) y la CLI.
- Depende de la lista de denegación del cambio `agent-containment` para no copiar secretos.
