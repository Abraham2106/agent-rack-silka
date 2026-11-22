# session-notes Specification

## Purpose

Notas por sesión, paginadas y volátiles, con los conflictos de archivos guardados como estado de la tarea y no como notas.

## Requirements

### Requirement: FR-SN-01 Notas por sesión
The system SHALL guardar las notas de cada sesión en su propio archivo. Escribir una nota MUST NOT bloquear ni leer
las notas de otras sesiones.

#### Scenario: Aislamiento entre sesiones (SN-01)
- **WHEN** dos sesiones escriben notas a la vez
- **THEN** cada una queda solo en su archivo y ninguna ve las de la otra

### Requirement: FR-SN-02 Lectura acotada
The system SHALL devolver en `silka_notes` con sesión como máximo 20 notas (las más recientes) y un resumen del
resto con referencia; sin sesión SHALL devolver solo conteos por sesión (total y sin leer), nunca el contenido.

#### Scenario: Sin sesión (SN-02)
- **WHEN** se llama `silka_notes` sin indicar sesión
- **THEN** la respuesta lista sesiones con conteos y no incluye textos de notas

#### Scenario: Muchas notas (SN-03)
- **WHEN** una sesión tiene 100 notas
- **THEN** la respuesta trae las 20 más recientes y "80 más" con referencia

### Requirement: FR-SN-03 Volátiles
The system SHALL borrar el archivo de notas de una sesión cuando la sesión terminó y sus notas se leyeron, o cuando
su tarea quedó mezclada o descartada; si la sesión ya no existe en el hub, a las 24 h.

#### Scenario: Sesión cerrada y leída (SN-04)
- **WHEN** la sesión termina y el manager leyó sus notas
- **THEN** su archivo de notas se borra

#### Scenario: Sesión desaparecida (SN-05)
- **WHEN** el hub se reinicia y la sesión ya no existe
- **THEN** su archivo se borra a las 24 h aunque tenga notas sin leer

### Requirement: FR-SN-04 Conflictos como estado
The system SHALL registrar un conflicto (dos tareas que tocan el mismo archivo) como estado de las tareas, una
sola vez por par de tareas y archivo, y marcarlo resuelto cuando deja de darse. MUST NOT escribirlo como nota en
cada revisión.

#### Scenario: Conflicto sin repetición (SN-06)
- **WHEN** el detector ve el mismo conflicto en diez ciclos seguidos
- **THEN** hay una sola entrada de conflicto y ninguna nota nueva
