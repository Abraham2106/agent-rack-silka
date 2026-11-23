# role-skills Specification

## Purpose

Skills por rol (implementador, revisor, verificador) como archivos Markdown versionados, inyectadas de forma acotada en el encargo del agente.

## Requirements

### Requirement: FR-RS-01 Skills como archivos versionados
The system SHALL leer skills de `.silka/skills/<rol>/<nombre>.md`, con roles `implementador`, `revisor` o
`verificador` y una cabecera con rol y alcance. Una skill mal formada MUST ignorarse con aviso sin impedir
lanzar la tarea.

#### Scenario: Skill inválida (RS-01)
- **WHEN** una skill no declara rol en su cabecera
- **THEN** se ignora, se avisa su ruta y la tarea se lanza igual

### Requirement: FR-RS-02 Inyección acotada por rol y alcance
The system SHALL anteponer al encargo solo las skills del rol de la tarea cuyo alcance coincide, con tope de
tamaño (por defecto 3 KB) y una referencia a las que no quepan, reutilizando la selección de memoria.

#### Scenario: Solo el rol y el alcance (RS-02)
- **WHEN** se encarga una tarea `implementador` con alcance `src/silka/ui/`
- **THEN** el prompt incluye skills de ese rol para la UI y ninguna de `revisor`

#### Scenario: Tope respetado (RS-03)
- **WHEN** las skills aplicables superan el tope
- **THEN** el prompt incluye las primeras hasta el tope y una referencia al resto

### Requirement: FR-RS-03 Listado
The system SHALL ofrecer `silka skills ls` con rol, alcance y tamaño de cada skill, y `--json` para el manager.

#### Scenario: Listar (RS-04)
- **WHEN** hay dos skills válidas y una inválida
- **THEN** `silka skills ls` muestra las dos válidas y marca la inválida con su causa

### Requirement: FR-RS-04 Solo lectura de contenido
The system SHALL tratar las skills como texto: MUST NOT ejecutar nada de su contenido ni leer rutas fuera de
`.silka/skills/`.

#### Scenario: Ruta fuera (RS-05)
- **WHEN** el nombre de una skill intenta salir de la carpeta con `..`
- **THEN** se rechaza y no se lee el archivo
