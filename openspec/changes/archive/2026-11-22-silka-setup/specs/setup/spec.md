## ADDED Requirements

### Requirement: FR-ST-01 Detección de agentes
The system SHALL detectar con `silka setup` qué CLIs de agentes (codex, opencode, cursor) están instalados,
reutilizando la detección de doctor, y MUST informar los que faltan sin intentar instalarlos.

#### Scenario: Agente ausente (ST-01)
- **WHEN** cursor no está en el PATH
- **THEN** setup lo lista como no instalado y no intenta instalarlo

### Requirement: FR-ST-02 Vista previa por defecto
The system SHALL ejecutar `silka setup` en modo `--dry-run` por defecto, mostrando un diff de cada archivo que
cambiaría, y MUST NOT escribir ni modificar nada en ese modo.

#### Scenario: Sin escritura (ST-02)
- **WHEN** se corre `silka setup` sin banderas
- **THEN** se imprime el diff y ningún archivo cambia

### Requirement: FR-ST-03 Aplicación explícita y acotada
The system SHALL escribir solo con `--apply`, y solo bajo la carpeta de config de Silka. MUST NOT tocar la config
global de agent-rack ni la de los agentes o del harness.

#### Scenario: Aplicar (ST-03)
- **WHEN** se corre `silka setup --apply`
- **THEN** se escribe la config efectiva y el bridge bajo `~/.config/silka/` y no cambia ningún otro archivo

### Requirement: FR-ST-04 Idempotencia
The system SHALL no producir cambios al repetir `--apply` sobre un estado ya preparado, e informar que no hay nada
por hacer.

#### Scenario: Segunda ejecución (ST-04)
- **WHEN** se corre `silka setup --apply` dos veces seguidas
- **THEN** la segunda informa "sin cambios" y los archivos conservan su contenido y fecha

### Requirement: FR-ST-05 Salida para el manager
The system SHALL aceptar `--json` y devolver agentes detectados, cambios propuestos y si se aplicó, sin texto
adicional.

#### Scenario: JSON (ST-05)
- **WHEN** se corre `silka setup --json`
- **THEN** la salida es JSON válido con las tres secciones
