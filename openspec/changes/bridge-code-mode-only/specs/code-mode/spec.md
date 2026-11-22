## MODIFIED Requirements

### Requirement: FR-CM-07 Compatibilidad MCP
The system SHALL mantener las herramientas MCP clásicas sin cambios de comportamiento **solo en el modo de
compatibilidad** del bridge, que se activa de forma explícita (`SILKA_BRIDGE_TOOLS=all` o la opción equivalente
del bridge). Fuera de ese modo, el bridge SHALL exponer únicamente las herramientas de Code Mode (FR-CM-11).

#### Scenario: Regresión de suite
- **WHEN** se ejecuta `npm test` en el repositorio
- **THEN** las pruebas del bridge y Code Mode pasan junto al resto de la suite

#### Scenario: Modo de compatibilidad (BC-03)
- **WHEN** el bridge arranca con `SILKA_BRIDGE_TOOLS=all`
- **THEN** expone las herramientas clásicas con el mismo comportamiento que antes del cambio

## ADDED Requirements

### Requirement: FR-CM-11 Superficie mínima por defecto
The system SHALL exponer por defecto en el bridge MCP solo `silka_search` y `silka_execute`. Ninguna otra
herramienta MUST aparecer en la lista de herramientas del bridge salvo en el modo de compatibilidad.

#### Scenario: Lista de herramientas por defecto (BC-01)
- **WHEN** un cliente lista las herramientas del bridge sin configuración especial
- **THEN** recibe exactamente `silka_search` y `silka_execute`

#### Scenario: Herramienta clásica pedida por nombre (BC-02)
- **WHEN** en el modo por defecto un cliente llama a una herramienta clásica (por ejemplo `agent_session_create`)
- **THEN** recibe un error que explica cómo hacerlo con Code Mode o cómo activar el modo de compatibilidad

### Requirement: FR-CM-12 Paridad de funciones en la API
The system SHALL ofrecer en la API de Code Mode (`silka.*`) todas las operaciones que hoy cubren las herramientas
clásicas del bridge (sesiones, envío, notas, estado, decisiones, revisión y mezcla), de modo que el modo mínimo no
pierda funciones.

#### Scenario: Paridad comprobada (BC-04)
- **WHEN** se compara la lista de herramientas clásicas con los métodos de `silka.d.ts`
- **THEN** cada herramienta clásica tiene un método equivalente documentado

### Requirement: NFR-TOK-03 Ahorro de contexto medido
The system SHALL documentar, con `/context` o `claude plugin details`, cuánto contexto fijo ocupa el bridge en el
modo por defecto frente al modo de compatibilidad.

#### Scenario: Medición registrada (BC-05)
- **WHEN** se completa el cambio
- **THEN** existe una medición de antes y después del contexto fijo del bridge, sin cifras estimadas a mano
