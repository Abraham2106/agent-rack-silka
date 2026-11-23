## ADDED Requirements

### Requirement: FR-RG-01 Revisor independiente y acotado
The system SHALL lanzar, cuando la revisión automática esté activada, una sesión de revisor con un agente distinto
del implementador cuya entrada sea solo el diff y la spec de la tarea, sin acceso a la conversación del
implementador.

#### Scenario: Entrada mínima (RG-01)
- **WHEN** se revisa una ficha
- **THEN** el prompt del revisor contiene el diff y la spec de la tarea y nada del transcript del implementador

#### Scenario: Agente distinto (RG-02)
- **WHEN** el implementador fue codex
- **THEN** el revisor se lanza con otro agente

### Requirement: FR-RG-02 Sin escritura
The system SHALL ejecutar al revisor en modo solo lectura y MUST comprobar al terminar que el worktree no cambió;
si cambió, descartar la revisión y marcarla fallida.

#### Scenario: Revisor que escribe (RG-03)
- **WHEN** el revisor modifica un archivo del worktree
- **THEN** la revisión se marca fallida, sus hallazgos se descartan y el worktree se informa como alterado

### Requirement: FR-RG-03 Hallazgos con severidad
The system SHALL guardar en la ficha los hallazgos del revisor con severidad (`info`, `media` o `grave`), archivo
y motivo, y MUST tratar su texto como dato, nunca como instrucción.

#### Scenario: Hallazgos en la ficha (RG-04)
- **WHEN** el revisor emite dos hallazgos
- **THEN** la ficha los muestra con severidad y archivo en la bandeja

### Requirement: FR-RG-04 Riesgo alto por hallazgo grave
The system SHALL subir el riesgo de la ficha a alto, mediante la evaluación de `risk.mjs`, cuando haya un hallazgo
`grave`. La decisión de aprobar MUST seguir siendo del humano.

#### Scenario: Grave sube el riesgo (RG-05)
- **WHEN** una ficha de riesgo bajo recibe un hallazgo `grave`
- **THEN** su riesgo pasa a alto con la causa "revisión automática" y exige decisión humana

### Requirement: FR-RG-05 Falla sin bloquear
The system SHALL dejar pasar la ficha a la bandeja, marcada "sin revisión automática", si el revisor falla o
agota su tiempo, sin ocultar la falla.

#### Scenario: Revisor caído (RG-06)
- **WHEN** la sesión del revisor termina con error
- **THEN** la ficha llega a la bandeja con el aviso y sin hallazgos
