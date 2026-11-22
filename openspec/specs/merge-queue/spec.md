# merge-queue Specification

## Purpose
Cola de mezcla con un solo escritor: integra lo aprobado en la rama destino una tarea a la vez, re-verificada sobre el estado real, devolviendo fallos al agente sin reescribir historia.

## Requirements

### Requirement: FR-MQ-01 Dueño único y fencing
The system SHALL permitir un solo dueño de la cola (hub con lease vigente y fencing token creciente); operaciones con token obsoleto abortan.

#### Scenario: Dos hubs (T-MQ-03)
- **WHEN** dos hubs intentan mezclar a la vez
- **THEN** solo el del token vigente completa la mezcla

### Requirement: FR-MQ-02 Orden FIFO (pendiente reorden manual)
The system SHALL ordenar por momento de aprobación en FIFO; nadie se adelanta salvo acción explícita del humano. **Pendiente:** reorden manual del humano.

#### Scenario: Secuencia aprobada (T-MQ-01)
- **WHEN** dos tareas se aprueban en orden
- **THEN** la cola las procesa en ese orden FIFO

### Requirement: FR-MQ-03 Pasos con diario
The system SHALL anotar en `.silka/merge-journal.jsonl` antes y después de cada paso: rebase de `silka/<id>`, verify en worktree, fast-forward de la rama destino.

#### Scenario: Diario en caída (T-MQ-02)
- **WHEN** el hub muere entre pasos
- **THEN** al reiniciar el diario permite reanudar sin doble mezcla

### Requirement: FR-MQ-04 Fallos a reparación
The system SHALL enviar conflicto de rebase o verify fallido a "reparando" con error íntegro al agente y continuar la cola con la siguiente tarea.

#### Scenario: Dos tareas que rompen juntas (T-MQ-01)
- **WHEN** la segunda mezcla falla verify sobre el estado combinado
- **THEN** esa tarea vuelve a reparando y la rama destino queda verde

### Requirement: FR-MQ-05 Árbol del builder sucio
The system SHALL no tocar el árbol del builder con cambios sin commitear; actualiza referencia solo si el árbol está limpio, si no avisa.

#### Scenario: Main sucio (T-MQ-04)
- **WHEN** la rama destino tiene cambios locales sin commit
- **THEN** la mezcla no toca el árbol y se avisa

### Requirement: FR-MQ-06 Sin push ni reescritura
The system SHALL nunca hacer push, force-push ni reescribir historia de la rama destino.

#### Scenario: Ancestros preservados (I-WV-05)
- **WHEN** se mezclan varias tareas
- **THEN** los SHA anteriores de la rama destino siguen siendo ancestros

### Requirement: FR-MQ-07 Recuperación ante caídas
The system SHALL al arrancar leer el diario y reanudar o revertir el paso a medias con pasos idempotentes y CAS en `update-ref`.

#### Scenario: Inyección de fallo (T-MQ-02)
- **WHEN** se mata el hub entre pasos
- **THEN** no hay doble mezcla ni rama destino rota al reiniciar

### Requirement: FR-MQ-08 Cierre de mezcla
The system SHALL al mezclar registrar métrica, eliminar worktree y rama, y desbloquear tareas que dependían (FR-TK-03).

#### Scenario: Desbloqueo (T-TK-02)
- **WHEN** una tarea dependiente esperaba la mezcla
- **THEN** puede iniciar tras FR-MQ-08

### Requirement: FR-MQ-09 Visibilidad de cola
The system SHALL exponer posición y paso actual en TUI y API (`silka.merge.queue()`, `status(id)`).

#### Scenario: API de cola (T-MQ-01)
- **WHEN** se consulta `merge.queue` desde Code Mode
- **THEN** se ve la cola y el estado de cada ítem

### Requirement: NFR-QUA-02 Roturas al mezclar
The system SHALL detectar siempre antes de actualizar la rama cuando una mezcla rompe; objetivo menor a 1 de cada 5 aprobadas rompe sin detección.

#### Scenario: Detección en cola (T-MQ-01)
- **WHEN** verify post-rebase falla
- **THEN** la rama destino no recibe el fast-forward roto

### Requirement: NFR-REL-01 Corrección ante caídas
The system SHALL garantizar que matar el hub en cualquier paso no deja la rama destino no verificada ni mezcla dos veces.

#### Scenario: T-MQ-02
- **WHEN** se interrumpe durante verify o update-ref
- **THEN** la recuperación deja un estado consistente

### Requirement: NFR-PERF-03 Rendimiento de la cola
The system SHALL completar cada tarea en aproximadamente el tiempo de verify más rebase y actualización (< 5 s de overhead).

#### Scenario: Paso típico (T-MQ-01)
- **WHEN** verify es rápido en pruebas
- **THEN** el overhead de cola permanece bajo el umbral

### Requirement: SEC-10 CAS en update-ref
The system SHALL usar compare-and-swap al actualizar la rama destino; si la ref cambió, abortar y reintentar el ciclo.

#### Scenario: Rama movida (T-MQ-05)
- **WHEN** alguien mueve la rama destino a mano durante la mezcla
- **THEN** CAS detecta el cambio y se reintenta