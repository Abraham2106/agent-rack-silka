# review-inbox Specification

## Purpose
Bandeja de revisión: el builder decide entregas rápido viendo lo esencial y cargando detalle por referencia solo cuando lo pide.

## Requirements

### Requirement: FR-RV-01 Orden de la bandeja
The system SHALL listar tareas en "lista para revisión" y "verificación fallida", ordenadas por riesgo (alto, medio, bajo) y luego antigüedad.

#### Scenario: Listado (T-RV-01)
- **WHEN** hay varias tareas en bandeja
- **THEN** el orden respeta riesgo y antigüedad

### Requirement: FR-RV-02 Acciones idempotentes con versión
The system SHALL ofrecer aprobar, rechazar con nota y descartar como acciones idempotentes con el número de versión visto; si la tarea cambió, rechazar con `E_STALE` y refrescar la ficha.

#### Scenario: Doble aprobación (T-RV-01)
- **WHEN** se aprueba dos veces la misma versión
- **THEN** la segunda es un no-op

#### Scenario: Versión obsoleta (T-RV-02)
- **WHEN** se aprueba una versión vieja tras re-entrega
- **THEN** la acción falla con `E_STALE`

### Requirement: FR-RV-03 Rechazo reanuda conversación
The system SHALL enviar la nota de rechazo a la misma conversación del agente y devolver la tarea a "trabajando".

#### Scenario: Rechazo con nota (T-RV-05)
- **WHEN** el builder rechaza con nota
- **THEN** el agente recibe la nota en la misma sesión

### Requirement: FR-RV-04 Aprobación encola mezcla
The system SHALL pasar la tarea aprobada a la cola de mezcla sin mezclar en el momento.

#### Scenario: Flujo a cola (T-MQ-01)
- **WHEN** se aprueba una tarea
- **THEN** entra en cola FIFO sin merge inmediato

### Requirement: FR-RV-05 Detalle por referencia
The system SHALL cargar diff, log de verificación y transcript por referencia solo a pedido; la ficha nunca incluye el diff completo.

#### Scenario: Ficha resumida (T-RV-04)
- **WHEN** se muestra la ficha en bandeja
- **THEN** el diff completo no está embebido

### Requirement: FR-RV-06 Auditoría de decisiones
The system SHALL registrar cada decisión en `.silka/reviews.jsonl` con quién, cuándo, versión vista y acción.

#### Scenario: Aprobación auditada (T-RV-01)
- **WHEN** se aprueba una tarea
- **THEN** queda una línea en reviews.jsonl

### Requirement: FR-RV-07 Vista TUI de la bandeja (pendiente)
The system SHALL en el TUI abrir la bandeja con `r`, aprobar con `a`, rechazar con `x`, descartar con `d` y abrir detalle con enter. **Pendiente:** vista TUI completa aún no entregada.

#### Scenario: API equivalente (T-RV-05)
- **WHEN** se usa la API `silka.review.*`
- **THEN** las acciones de bandeja funcionan aunque la vista TUI dedicada siga pendiente

### Requirement: FR-RV-08 API de revisión
The system SHALL exponer `silka.review.inbox()`, `approve(id, { version })`, `reject(id, note, { version })` y `discard(id, { version })`.

#### Scenario: Idempotencia API (T-RV-01)
- **WHEN** se invocan las funciones de revisión vía Code Mode
- **THEN** comportamiento coincide con la bandeja CLI

### Requirement: NFR-UX-01 Decidir sin transcript
The system SHALL permitir decidir una ficha en menos de 1 minuto sin abrir el transcript.

#### Scenario: Política de riesgo (T-RV-03)
- **WHEN** el builder evalúa riesgo en la ficha
- **THEN** puede decidir sin abrir el transcript completo

### Requirement: NFR-UX-02 Apertura de bandeja grande
The system SHALL abrir la bandeja con 50 tareas en menos de 1 s.

#### Scenario: Listado rápido (T-RV-01)
- **WHEN** se lista el inbox con hasta 50 tareas
- **THEN** la respuesta llega en menos de 1 s en condiciones de referencia

### Requirement: SEC-08 Humano en riesgo alto
The system SHALL exigir humano para aprobar riesgo alto o archivos sensibles; el manager recibe `E_POLICY`.

#### Scenario: Manager bloqueado (T-RV-03)
- **WHEN** el manager intenta aprobar riesgo alto
- **THEN** recibe `E_POLICY`

### Requirement: SEC-09 Ficha como dato
The system SHALL mostrar texto del agente escapado (ANSI/OSC) y marcado como dicho por el agente, sin que instrucciones embebidas tengan efecto.

#### Scenario: Secuencias de terminal (T-RV-04)
- **WHEN** el resumen del agente contiene ANSI u OSC
- **THEN** se muestran escapadas sin ejecutar secuencias