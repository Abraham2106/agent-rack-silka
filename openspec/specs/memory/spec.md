# memory Specification

## Purpose

Memoria persistente de decisiones, aprendizajes y preferencias, inyectada de forma acotada en las tareas según su alcance.

## Requirements

### Requirement: FR-MEM-01 Entradas con tipo
The system SHALL guardar entradas de memoria por workspace con tipo (`decisión`, `aprendizaje` o `preferencia`),
texto, etiquetas de alcance (rutas o áreas), autor, fuente y fecha, sobre el registro de decisiones existente.

#### Scenario: Agregar un aprendizaje (MEM-01)
- **WHEN** el manager agrega un aprendizaje con etiqueta `src/silka/tasks/`
- **THEN** queda guardado con tipo, etiqueta, autor y fecha, y aparece en `silka memory ls`

### Requirement: FR-MEM-02 Inyección acotada por alcance
The system SHALL anteponer al encargo de cada tarea solo las entradas vigentes cuyas etiquetas coinciden con el
alcance de la tarea, ordenadas por relevancia, con un tope de tamaño (por defecto 2 KB). Lo que no quepa MUST ir
como referencia, no como texto.

#### Scenario: Solo lo relevante (MEM-02)
- **WHEN** se encarga una tarea con alcance `src/silka/ui/`
- **THEN** el prompt incluye las entradas etiquetadas para la UI y no las de la cola de mezcla

#### Scenario: Tope respetado (MEM-03)
- **WHEN** las entradas relevantes superan el tope
- **THEN** el prompt incluye las más relevantes hasta el tope y una referencia al resto

### Requirement: FR-MEM-03 Aprendizajes desde fichas fallidas
The system SHALL permitir que una ficha fallida proponga un aprendizaje (qué falló y por qué). La propuesta MUST
quedar pendiente hasta que el humano o el manager la confirme; no entra en la memoria sola.

#### Scenario: Propuesta pendiente (MEM-04)
- **WHEN** una tarea falla por la misma causa que otra anterior
- **THEN** se propone un aprendizaje que no se inyecta hasta ser confirmado

### Requirement: FR-MEM-04 Vigencia sin borrado
The system SHALL marcar entradas como vencidas o reemplazadas en lugar de borrarlas; las vencidas MUST NOT
inyectarse.

#### Scenario: Entrada reemplazada (MEM-05)
- **WHEN** una preferencia se reemplaza por otra
- **THEN** la vieja queda marcada y ya no se inyecta
