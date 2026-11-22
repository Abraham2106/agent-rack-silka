## ADDED Requirements

### Requirement: FR-TK-12 Receta del workspace
The system SHALL leer, si existe, `silka.json` en la raíz del repo con `setup`, `run` (comandos con nombre),
`archive`, `copy`, `ports`, `runMode` y `shell`, aceptando variantes por sistema (`win` y `posix`). Sin el archivo,
el comportamiento SHALL ser el actual (setup inferido por lockfile).

#### Scenario: Receta con variante de Windows (WR-01)
- **WHEN** `silka.json` define `setup` con variantes `win` y `posix`
- **THEN** en Windows se corre la variante `win` con el shell declarado

### Requirement: FR-TK-13 Archivos no versionados
The system SHALL copiar al worktree los archivos indicados en `copy` y en `.worktreeinclude`, y por defecto los
`.env*`, excepto los que la lista de denegación de secretos excluya.

#### Scenario: Copia respetando la denegación (WR-02)
- **WHEN** `copy` incluye `.env*` y la lista de denegación excluye `.env.production`
- **THEN** el worktree recibe `.env.local` y no recibe `.env.production`

### Requirement: FR-TK-14 Puertos y entorno por tarea
The system SHALL reservar para cada tarea un rango contiguo de puertos libres (por defecto 10) bajo lock,
comprobando que estén libres, y SHALL exponer a setup, run, verify y al agente las variables `SILKA_PORT`,
`SILKA_WORKSPACE_PATH`, `SILKA_ROOT_PATH`, `SILKA_WORKSPACE_NAME`, `SILKA_TASK_ID` y `SILKA_DEFAULT_BRANCH`.

#### Scenario: Dos tareas sin choque de puertos (WR-03)
- **WHEN** dos tareas corren a la vez
- **THEN** sus rangos de puertos no se solapan y cada una ve su `SILKA_PORT`

### Requirement: FR-TK-15 Levantar, detener y cerrar
The system SHALL permitir `run <nombre>`, `stop` y `archive` de una tarea. `archive` MUST detener primero el árbol
de procesos de la tarea, correr el comando `archive` de la receta y solo después quitar el worktree (soltando los
enlaces sin seguirlos) y liberar sus puertos. Con `runMode: exclusive` SHALL haber como máximo un `run` vivo por
repo.

#### Scenario: Cerrar con un servidor vivo en Windows (WR-04)
- **WHEN** se archiva una tarea con su servidor de desarrollo corriendo
- **THEN** el servidor se detiene, el worktree se borra sin `EBUSY` y el `node_modules` del repo principal queda intacto

#### Scenario: Modo exclusivo (WR-05)
- **WHEN** `runMode` es `exclusive` y ya hay un `run` vivo en el repo
- **THEN** un segundo `run` se rechaza con el motivo
