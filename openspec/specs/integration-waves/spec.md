# integration-waves Specification

## Purpose
Integración por oleadas: tras mezclar cada oleada de tareas dependientes, Silka verifica la combinación en un worktree limpio, identifica culpables y bloquea oleadas siguientes hasta pasar, sin revertir la rama destino.

## Requirements

### Requirement: FR-IW-01 Oleadas en el plan
The system SHALL agrupar tareas del plan por nivel de dependencias (oleada 0 sin deps, oleada n depende de anteriores) o por `waves` declaradas a mano; el plan admite `integration: { verify?, accept?, maxRepairs? }`.

#### Scenario: Dos oleadas en secuencia (I-WV-01)
- **WHEN** un plan tiene dos oleadas que pasan por separado
- **THEN** la integración corre al completar cada oleada mezclada

### Requirement: FR-IW-02 Punto de integración
The system SHALL ejecutar verify de integración sobre la punta de la rama destino en worktree temporal limpio (nunca el árbol del builder) y borrarlo al terminar; la oleada siguiente no arranca hasta pasar.

#### Scenario: Bloqueo de oleada siguiente (I-WV-02)
- **WHEN** la integración de una oleada falla
- **THEN** las tareas de la oleada siguiente quedan bloqueadas con motivo visible

### Requirement: FR-IW-03 Culpable y reparación
The system SHALL ante fallo buscar la primera mezcla de la oleada que rompe (orden lineal en worktrees temporales, diario idempotente), crear tarea de reparación ligada o ficha de oleada de riesgo alto si no hay culpable; nunca revertir la rama destino (FR-MQ-06).

#### Scenario: Culpable identificado (I-WV-02)
- **WHEN** dos tareas pasan solas y rompen juntas
- **THEN** Silka identifica culpable y encola reparación por el flujo normal

#### Scenario: Sin culpable (I-WV-03)
- **WHEN** el fallo es solo por combinación
- **THEN** entra ficha de oleada "integración fallida" en bandeja con riesgo alto

### Requirement: FR-IW-04 Visibilidad del plan
The system SHALL exponer oleadas, estado, evidencia de integración y bloqueos vía `silka.plan.status(planId)` y `silka plan status <id>`.

#### Scenario: Estado del plan (I-WV-01)
- **WHEN** el manager consulta plan status
- **THEN** ve oleadas y evidencia de integración

### Requirement: FR-IW-05 Recuperación de integración
The system SHALL retomar integración o búsqueda de culpable tras reinicio del hub sin repetir trabajo ya registrado en el diario.

#### Scenario: Reinicio a mitad (I-WV-04)
- **WHEN** el hub se reinicia durante integración
- **THEN** retoma sin duplicar pasos completados

#### Scenario: Historia preservada (I-WV-05)
- **WHEN** se completan mezclas e integraciones
- **THEN** los SHA previos de la rama destino siguen siendo ancestros