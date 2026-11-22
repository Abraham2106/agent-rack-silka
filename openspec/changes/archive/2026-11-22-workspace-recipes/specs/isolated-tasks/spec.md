## ADDED Requirements

### Requirement: FR-TK-12 Receta del workspace
The system SHALL leer, si existe, `silka.json` en la raíz del repo con `setup`, `run` (comandos con nombre),
`archive`, `copy`, `ports`, `runMode` y `shell`, aceptando variantes por sistema (`win` y `posix`). Sin el archivo,
el comportamiento SHALL ser el actual (setup inferido por lockfile).

#### Scenario: Receta con variante de Windows (WR-01)
- **WHEN** `silka.json` define `setup` con variantes `win` y `posix`
- **THEN** en Windows se corre la variante `win` con el shell declarado

### Requirement: FR-TK-13 Archivos no versionados
The system SHALL copiar al worktree solo los archivos que el repo declara en `copy` (de `silka.json`) o en
`.worktreeinclude`. Sin una entrada explícita (ruta literal, p. ej. `.env.local`) SHALL NOT copiar ningún `.env*`. Una
entrada explícita SHALL ganar sobre el patrón `.env*` de la lista de denegación de secretos, pero MUST NOT ganar sobre
`.env.production`, `.env.*.production`, llaves privadas (`*.pem`, `*.key`, `id_*`), `~/.ssh`, otros patrones de la
lista ni rutas fuera del repo. Un comodín (p. ej. `.env*`) NO cuenta como entrada explícita y SHALL pasar por la
lista de denegación completa.

#### Scenario: Entrada explícita copia el .env.local (WR-02)
- **WHEN** `copy` incluye `.env.local` y el archivo existe sin versionar
- **THEN** el worktree recibe `.env.local`

#### Scenario: Sin entrada explícita no se copia ningún .env (WR-02)
- **WHEN** el repo no declara ningún `.env*` en `copy` ni en `.worktreeinclude`
- **THEN** el worktree no recibe ningún `.env*`

#### Scenario: Secretos duros nunca se copian (WR-02)
- **WHEN** `copy` declara `.env.production`, `.env.eu.production`, `server.pem`, `api.key`, `id_rsa` o `../fuera.txt`
- **THEN** ninguno se copia y cada uno queda en `skipped` con el motivo

#### Scenario: Un comodín amplio no abre secretos (WR-02)
- **WHEN** `copy` incluye `.env*` y rige la lista de denegación por defecto
- **THEN** el worktree no recibe `.env.local` ni `.env.production`

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
