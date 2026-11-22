## ADDED Requirements

### Requirement: FR-TB-01 Dos caminos con las mismas tareas
The system SHALL ejecutar un conjunto fijo de N tareas (N ≥ 3, definidas en un archivo versionado) por dos
caminos: el manager resolviéndolas solo y el manager delegándolas con Silka mediante Code Mode. Ambos caminos MUST
partir del mismo commit y usar las mismas instrucciones de tarea.

#### Scenario: Mismo punto de partida (TB-01)
- **WHEN** se corre el benchmark
- **THEN** los dos caminos parten del mismo commit y del mismo archivo de tareas, y el informe registra ambos

### Requirement: FR-TB-02 Tokens reales del proveedor
The system SHALL medir los tokens de entrada y salida del manager con el uso que reporta el proveedor. MUST NOT
usar estimaciones por caracteres; si un camino no reporta uso, SHALL marcarlo como "sin dato" y no calcular
ahorro.

#### Scenario: Sin dato del proveedor (TB-02)
- **WHEN** un camino no reporta uso de tokens
- **THEN** el informe muestra "sin dato" para ese camino y no muestra porcentaje de ahorro

### Requirement: FR-TB-03 Calidad con la misma vara
The system SHALL medir en los dos caminos: verify a la primera, número de reparaciones, roturas al mezclar y
archivos fuera de alcance. Un ahorro de tokens con peor calidad MUST mostrarse como tal, no como mejora.

#### Scenario: Ahorro con peor calidad (TB-03)
- **WHEN** el camino con Silka gasta menos tokens pero tiene más roturas al mezclar
- **THEN** el informe muestra las dos cifras juntas y no declara mejora neta

### Requirement: NFR-TOK-01 Meta de ahorro medida
The system SHALL reportar si se cumple la meta de v1: al menos 70% menos tokens de entrada del manager con Code
Mode frente al camino sin Silka, con calidad igual o mejor.

#### Scenario: Meta evaluada (TB-04)
- **WHEN** termina una corrida con datos de los dos caminos
- **THEN** el informe dice "cumple" o "no cumple" la meta del 70% con el porcentaje medido

### Requirement: FR-TB-04 Informe reproducible
The system SHALL guardar cada corrida en `docs/benchmarks/` con fecha, commit, modelos usados, la tabla
comparativa y los límites de la medición.

#### Scenario: Informe guardado (TB-05)
- **WHEN** termina una corrida
- **THEN** existe un informe nuevo en `docs/benchmarks/` con commit, modelos y tabla
