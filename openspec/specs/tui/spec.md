# tui Specification

## Purpose
Interfaz TUI de Silka: arranque rápido, entrada de teclado fluida, escaneo de workspace sin bloquear el hilo principal y animaciones opcionales respetando accesibilidad.

## Requirements

### Requirement: FR-UI-01 Producción en el proceso TUI
The system SHALL ejecutar `silka ui` con `NODE_ENV=production` solo en su proceso y quitar esa variable vía `harnessFreeEnv` antes de pasar entorno a agentes en el hub.

#### Scenario: Entorno a agentes (TP-01)
- **WHEN** el TUI fija NODE_ENV para React
- **THEN** `harnessFreeEnv` no envía NODE_ENV del TUI a los agentes pero conserva el del usuario

### Requirement: FR-UI-02 Escaneo en worker
The system SHALL ejecutar lecturas git del workspace en un worker (`workspace-worker`, `scanner`) con intervalo espaciado, caché por ciclo y sondeo de sesiones ~0,5 s sin congelar teclado.

#### Scenario: Espaciado de escaneo (TP-02)
- **WHEN** no hay cambios de estado dentro del intervalo
- **THEN** no se repite el escaneo git completo

#### Scenario: Worker no bloquea (TP-04)
- **WHEN** corre el escaneo en background
- **THEN** el hilo principal sigue respondiendo al teclado

### Requirement: FR-UI-03 Carga instantánea
The system SHALL mostrar splash de carga de inmediato mientras Ink/React y la conexión al hub cargan en paralelo; primer contenido en pantalla < 1 s en condiciones medidas (scripts/tui-timing.mjs).

#### Scenario: Actualización y repintado (TP-03)
- **WHEN** el scanner devuelve resultados
- **THEN** el TUI avisa para repintar con datos del tablero

### Requirement: FR-UI-04 Animaciones opcionales
The system SHALL animar logo, spinners y finalización de sesión solo cuando hay movimiento; respetar `NO_COLOR` y `SILKA_NO_ANIM`; aumentar maxFps a 30 cuando animaciones activas.

#### Scenario: Mediana de tecla (scripts/tui-timing.mjs)
- **WHEN** se mide eco de tecla en pty real
- **THEN** la mediana permanece por debajo de 200 ms tras las optimizaciones (objetivo ~65 ms en Windows de referencia)