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