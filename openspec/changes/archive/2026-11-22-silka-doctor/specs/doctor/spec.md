## ADDED Requirements

### Requirement: FR-DR-01 Diagnóstico por punto
The system SHALL ofrecer `silka doctor`, que revisa el entorno y devuelve, por cada punto, un estado (ok, aviso o
falla), la causa y el arreglo sugerido. Puntos mínimos: versión de Node, agent-rack y su config, carpeta de
worktrees dentro de `allowedWorkspaces` efectivo, número de hubs vivos y si responden, bridges vivos, CLIs de
agentes instalados y con sesión, worktrees huérfanos, enlaces de `node_modules`, registro de repos, tamaño de
notas y logs.

#### Scenario: Carpeta de worktrees no permitida (DR-01)
- **WHEN** la carpeta de worktrees de Silka no está cubierta por `allowedWorkspaces`
- **THEN** doctor marca falla, explica que ninguna tarea aislada podrá arrancar y sugiere el arreglo

#### Scenario: Varios hubs (DR-02)
- **WHEN** hay más de un proceso de hub vivo
- **THEN** doctor marca falla y lista sus pids

#### Scenario: Bridge con código viejo (DR-03)
- **WHEN** un bridge vivo arrancó antes del último cambio del código de Silka
- **THEN** doctor marca aviso y sugiere reconectar el MCP o abrir una sesión nueva

### Requirement: FR-DR-02 Solo lectura
The system SHALL hacer que doctor solo lea: MUST NOT modificar archivos, matar procesos ni cambiar configuración.

#### Scenario: Sin efectos (DR-04)
- **WHEN** se corre doctor con fallas presentes
- **THEN** ningún archivo ni proceso cambia

### Requirement: FR-DR-03 Salida para el manager
The system SHALL aceptar `--json` y devolver la lista de puntos con estado, causa y arreglo, sin texto adicional,
y SHALL terminar con código distinto de cero si hay alguna falla.

#### Scenario: JSON y código de salida (DR-05)
- **WHEN** se corre `silka doctor --json` con una falla
- **THEN** la salida es JSON válido con el punto en falla y el código de salida no es cero
