# model-routing Specification

## Purpose

Enrutado de modelos por rol y tamaño de tarea, configurable en un archivo versionado y con registro de qué modelo corrió cada tarea.

## Requirements

### Requirement: FR-MR-01 Tabla versionada de enrutado
The system SHALL leer `.silka/routing.json`, que asigna agente y modelo por rol (`planificar`, `implementar`,
`revisar`) y por tamaño (`chica`, `media`, `grande`), y SHALL usar valores por defecto documentados si falta. Un
archivo inválido MUST rechazarse con el campo en falla, sin lanzar la tarea.

#### Scenario: Sin archivo (MR-01)
- **WHEN** no existe `.silka/routing.json`
- **THEN** se usan los valores por defecto y el comportamiento es el actual

#### Scenario: Archivo inválido (MR-02)
- **WHEN** el archivo nombra un rol desconocido
- **THEN** la carga falla con un mensaje que nombra el rol y ninguna tarea se lanza con esa tabla

### Requirement: FR-MR-02 Resolución en el encargo
The system SHALL resolver agente y modelo de una tarea en este orden: valor explícito de la tarea, regla de la
tabla para su rol y tamaño, y por último `defaultAgent` y `defaultModel`.

#### Scenario: Explícito gana (MR-03)
- **WHEN** una tarea pide el modelo X y la tabla dice Y
- **THEN** la sesión se crea con X

#### Scenario: Por tamaño (MR-04)
- **WHEN** una tarea de tamaño `chica` y rol `implementar` no pide modelo
- **THEN** la sesión usa el modelo que la tabla asigna a ese par

### Requirement: FR-MR-03 Registro en la ficha
The system SHALL guardar en cada ficha el rol, el agente, el modelo y la regla que los eligió (`explícito`,
`tabla` o `defecto`).

#### Scenario: Ficha con modelo (MR-05)
- **WHEN** una tarea termina
- **THEN** su ficha muestra agente, modelo y la regla usada

### Requirement: FR-MR-04 Modelo no disponible
The system SHALL saltar un modelo que `models.mjs` marque como no disponible y usar el siguiente de la lista de la
regla, anotándolo en la ficha. Si ninguno sirve, MUST usar el defecto y avisar.

#### Scenario: Caída al siguiente (MR-06)
- **WHEN** el primer modelo de una regla está marcado no disponible
- **THEN** se usa el segundo y la ficha dice que hubo caída
