# hub-connection Specification

## Purpose
Enlace resiliente con el hub: el TUI, el bridge MCP y los comandos reconectan tras 401, cortes SSE o reinicios del hub sin quedar en "fetch failed" permanente ni duplicar escrituras.

## Requirements

### Requirement: FR-HC-01 Reconexión con token vigente
The system SHALL reabrir la conexión al hub con el token vigente cuando el hub reinicia o el SSE cae; el bridge puede levantar el hub si murió.

#### Scenario: Hub reiniciado (HL-01)
- **WHEN** la primera petición falla por conexión rechazada tras reinicio
- **THEN** la siguiente petición reconecta y completa con éxito

### Requirement: FR-HC-02 Política de reintento
The system SHALL reintentar una vez solo si la petición no llegó al hub o es de lectura; una escritura cortada a mitad no se reintenta para evitar duplicados.

#### Scenario: Escritura cortada (HL-02)
- **WHEN** `sendInput` falla a mitad por reset
- **THEN** no se reintenta automáticamente y el error indica que no se reintenta

#### Scenario: Lectura cortada (HL-03)
- **WHEN** `listSessions` falla por reset en lectura
- **THEN** se reintenta en conexión nueva

### Requirement: FR-HC-03 Errores legibles
The system SHALL traducir errores de red (p. ej. fetch failed) a mensajes con código y dirección cuando estén disponibles.

#### Scenario: Mensaje descriptivo (HL-07)
- **WHEN** ocurre ECONNREFUSED
- **THEN** el mensaje incluye código y host:puerto

### Requirement: FR-HC-04 Cola de despacho ante hub caído
The system SHALL devolver a la cola de despacho un mensaje no entregado al hub en lugar de marcarlo fallido permanentemente.

#### Scenario: callTool lectura vs escritura (HL-04)
- **WHEN** callTool de lectura falla por red
- **THEN** se reintenta; cuando es escritura cortada, no

#### Scenario: Hub inexistente (HL-08)
- **WHEN** no hay hub disponible
- **THEN** error claro sin bucle infinito de reconexión