## ADDED Requirements

### Requirement: SEC-15 Los agentes no crean agentes
The system SHALL impedir que una sesión lanzada por Silka para una tarea cree otras sesiones de agente. El entorno
del agente MUST NOT exponer el MCP ni la CLI de agent-rack, y el hub SHALL rechazar `agent_session_create`
pedido desde una sesión de tarea por encima de la profundidad permitida (por defecto 1).

#### Scenario: Agente intenta lanzar otro agente (AC-01)
- **WHEN** un agente de una tarea pide crear una sesión de agente
- **THEN** la creación se rechaza con `E_POLICY`, no arranca ningún agente y el intento queda auditado

#### Scenario: Profundidad configurable (AC-02)
- **WHEN** la configuración permite profundidad 2
- **THEN** un agente de tarea puede crear una sesión, pero esa sesión ya no puede crear otra

### Requirement: SEC-16 Cada tarea ve solo su estado
The system SHALL limitar a cada agente al estado de su propia tarea. Un agente MUST NOT leer ni escribir el estado,
las fichas ni los logs de otras tareas; solo el hub escribe el estado de las tareas (I-6).

#### Scenario: Leer otra tarea (AC-03)
- **WHEN** un agente pide el estado o la ficha de otra tarea
- **THEN** recibe `E_POLICY` y no ve su contenido

### Requirement: SEC-17 Lista de denegación de secretos
The system SHALL mantener una lista de denegación de archivos sensibles (por defecto `.env*` salvo `.env.example`,
`~/.ssh/**`, `*.pem`, `*.key`, `id_*`). Esos archivos MUST NOT copiarse al worktree del agente ni incluirse en su
contexto, y una ficha cuyo diff los toque SHALL marcarse con riesgo alto (aprobación humana, SEC-08).

#### Scenario: Secreto fuera del worktree (AC-04)
- **WHEN** se crea el worktree de una tarea en un repo con `.env`
- **THEN** el worktree no contiene `.env` y el paquete de contexto no lo menciona por contenido

#### Scenario: Cambio a un archivo denegado (AC-05)
- **WHEN** el diff de una tarea toca un archivo de la lista
- **THEN** la ficha queda en riesgo alto y no se puede aprobar como manager

### Requirement: FR-AC-01 Intentos bloqueados visibles
The system SHALL auditar cada intento bloqueado por SEC-15, SEC-16 o SEC-17 con sesión, tarea, acción y hora, y
SHALL avisar al manager.

#### Scenario: Aviso al manager (AC-06)
- **WHEN** se bloquea un intento
- **THEN** queda en el registro de auditoría y el manager recibe un aviso con la tarea y la acción
