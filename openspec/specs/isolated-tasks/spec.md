# isolated-tasks Specification

## Purpose
Tareas aisladas en git worktree: cada delegación trabaja en su rama y directorio, Silka verifica al terminar el turno y entrega una ficha decidable sin abrir el transcript.

## Requirements

### Requirement: FR-TK-01 Worktree por tarea
The system SHALL crear la rama `silka/<id>` desde el commit base y el worktree **fuera del repo**, en `<datos de Silka>/wt/<repo>-<hash>/<id>`, al lanzar; la sesión del agente usa ese directorio de trabajo. Antes de arrancar al agente, el system SHALL correr el setup del worktree (por defecto enlaza `node_modules` si el lockfile coincide con el del repo principal; si no, instala) y guardar su evidencia; si falla, la tarea no arranca y queda en `verificacion_fallida`.

#### Scenario: Worktree fuera del repo (WG-01)
- **WHEN** se crea el worktree de una tarea
- **THEN** su ruta no cuelga del repo principal

#### Scenario: Setup antes del agente (WG-05, WG-06)
- **WHEN** se arranca la sesión del agente
- **THEN** el setup ya corrió y está en la evidencia; si falló, el agente no arranca

#### Scenario: Tres tareas paralelas (T-TK-01)
- **WHEN** se lanzan tres tareas en el mismo repositorio
- **THEN** cada ficha lista solo los archivos de su tarea sin mezclar cambios

### Requirement: FR-TK-02 Validación del modelo de tarea
The system SHALL rechazar con `E_TASK_INVALID` antes de crear recursos si falta un campo obligatorio del modelo (`title`, `scope`, `deliver`, `verify`).

#### Scenario: Lanzamiento válido (T-TK-01)
- **WHEN** la tarea cumple el modelo de §2
- **THEN** se crean worktree y sesión sin error

### Requirement: FR-TK-03 Dependencias entre tareas
The system SHALL no iniciar una tarea con `dependsOn` hasta que todas sus dependencias estén mezcladas; si una dependencia se descarta, la tarea queda bloqueada y se avisa.

#### Scenario: Espera de mezcla (T-TK-02)
- **WHEN** una tarea depende de otra no mezclada
- **THEN** permanece en espera hasta que la dependencia se mezcle

### Requirement: FR-TK-04 Verify en el worktree
The system SHALL ejecutar `verify` dentro del worktree al terminar el turno del agente, con tiempo límite y salida guardada por referencia `log:<id>#verify`. El setup solo se repite si cambió la huella de los lockfiles. Un setup fallido reprueba la ficha.

#### Scenario: Setup sin repetir (WG-07)
- **WHEN** el lockfile no cambió desde el setup inicial
- **THEN** verify no repite el setup y la evidencia del setup se conserva junto a la del verify

#### Scenario: Verify en paralelo (T-TK-01)
- **WHEN** terminan turnos de varias tareas
- **THEN** cada verify corre en su worktree y el resultado entra en la ficha

### Requirement: FR-TK-05 Contenido de la ficha
The system SHALL incluir en la ficha qué cambió (agente), archivos tocados (`git diff` contra base), resultado de `verify`, resumen del diff, preguntas abiertas y riesgo.

#### Scenario: Ficha aislada (T-TK-01)
- **WHEN** se genera la ficha de una tarea
- **THEN** solo refleja archivos y diff de esa tarea

### Requirement: FR-TK-06 Cálculo de riesgo
The system SHALL marcar riesgo alto si falla verify, hay cambios fuera de `scope`, se tocan archivos sensibles o el diff supera 400 líneas; medio si supera 120 líneas; bajo en otro caso.

#### Scenario: CI sensible (T-TK-03)
- **WHEN** la tarea toca `.github/workflows`
- **THEN** la ficha marca riesgo alto

### Requirement: FR-TK-11 Nunca trabajar en un worktree perdido
The system SHALL comprobar que el worktree de una tarea sigue siendo un worktree de git válido antes de arrancar al agente, verificar o reanudarlo para reparar; si no lo es, SHALL bloquear la tarea con el motivo y no ejecutar nada (BUG-06). Si una tarea se descarta mientras se crea su sesión, SHALL cancelar esa sesión.

#### Scenario: Worktree perdido (WG-03)
- **WHEN** el worktree de una tarea pierde su `.git`
- **THEN** no se verifica, no se escribe nada en el repo principal y la tarea queda bloqueada sin reanudar al agente

#### Scenario: Descarte durante el arranque (WG-04)
- **WHEN** la tarea se descarta mientras el hub crea su sesión
- **THEN** esa sesión se cancela y la tarea queda descartada sin sesión

### Requirement: FR-TK-07 Vida del worktree
The system SHALL eliminar worktree y rama solo al mezclar o descartar, y nunca mientras la sesión siga viva.

#### Scenario: Sesión viva (T-TK-05)
- **WHEN** se pide descartar con sesión activa
- **THEN** el worktree no se borra hasta cancelar la sesión

### Requirement: FR-TK-08 Tope de simultaneidad
The system SHALL limitar tareas simultáneas con `maxConcurrentTasks` (por defecto 5); el resto espera en orden.

#### Scenario: Concurrencia (T-CC-09)
- **WHEN** hay más tareas que el tope configurado
- **THEN** las excedentes quedan en cola hasta liberar cupo

### Requirement: FR-TK-09 Asignación de puertos
The system SHALL asignar puertos libres como `SILKA_PORT_1..n` si la tarea los pide, sin reutilizarlos mientras la tarea viva.

#### Scenario: Puertos por tarea (T-CC-09)
- **WHEN** dos tareas piden puertos en paralelo
- **THEN** reciben puertos distintos y libres

### Requirement: FR-TK-10 Cambios fuera de scope
The system SHALL no bloquear cambios fuera de `scope` pero marcarlos en la ficha y elevar el riesgo.

#### Scenario: Fuera de scope (T-TK-03)
- **WHEN** el diff toca rutas fuera del scope declarado
- **THEN** la ficha lo indica y sube el riesgo

### Requirement: NFR-UX-01 Decidir ficha
The system SHALL permitir decidir una ficha en menos de 1 minuto sin abrir el transcript.

#### Scenario: Bandeja (T-RV-05)
- **WHEN** el builder revisa la bandeja
- **THEN** puede aprobar o rechazar con la información resumida de la ficha

### Requirement: NFR-PORT-01 Plataformas
The system SHALL soportar Windows, macOS y Linux, incluyendo rutas con espacios y CRLF.

#### Scenario: Verify en Windows (reliability.test.mjs)
- **WHEN** verify ejecuta comandos con comillas en Windows
- **THEN** los códigos de salida se interpretan correctamente

### Requirement: NFR-DISK-01 Uso de disco
The system SHALL avisar si el número de worktrees vivos supera `maxConcurrentTasks` más tareas listas para revisión.

#### Scenario: Gestión de worktrees (T-TK-05)
- **WHEN** hay sesiones activas
- **THEN** no se eliminan worktrees prematuramente

### Requirement: SEC-06 Git sin hooks
The system SHALL ejecutar git siempre con `-c core.hooksPath=<vacío>` para que hooks escritos por agentes no corran en el hub.

#### Scenario: Hook del agente (T-TK-04)
- **WHEN** un agente escribe un hook en `.git/hooks`
- **THEN** el hub no lo ejecuta al hacer operaciones git

### Requirement: SEC-07 Verify solo comandos declarados
The system SHALL ejecutar en verify solo los comandos declarados en la tarea por quien la creó, nunca comandos sugeridos por el agente en su salida.

#### Scenario: Verify declarado (T-TK-01)
- **WHEN** el agente sugiere otro comando en texto
- **THEN** Silka solo corre los comandos del campo `verify` de la tarea

### Requirement: SEC-08 Riesgo alto y aprobación humana
The system SHALL marcar archivos sensibles como riesgo alto y impedir aprobación del manager sin humano (ver review-inbox).

#### Scenario: Riesgo alto en ficha (T-RV-03)
- **WHEN** la ficha tiene riesgo alto por archivos sensibles
- **THEN** el manager recibe `E_POLICY` al intentar aprobar

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
