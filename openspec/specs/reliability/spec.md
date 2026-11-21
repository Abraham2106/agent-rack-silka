# reliability Specification

## Purpose
Confiabilidad del estado de tarea: las transiciones dependen de evidencia que Silka comprueba (verify, criterios de aceptación y reparación acotada), nunca del texto del agente.

## Requirements

### Requirement: FR-RL-01 Ficha con evidencia separada
The system SHALL poner en la ficha `evidence` (verify y criterios con comando, código de salida, duración, ref al log) calculada por Silka, y el texto del agente en `agentSays` escapado sin cambiar el estado.

#### Scenario: Agente miente, verify falla (reliability.test.mjs)
- **WHEN** el agente declara éxito pero verify falla
- **THEN** la tarea no queda "lista para revisión"

### Requirement: FR-RL-02 Verify obligatorio o inferido
The system SHALL exigir `verify` o inferirlo del worktree (`package.json`, pytest, cargo, go); si no es inferible, `E_TASK_INVALID` al lanzar salvo `allowNoVerify: true` (riesgo alto).

#### Scenario: Inferencia npm (reliability.test.mjs)
- **WHEN** la tarea no declara verify pero hay `package.json` con script test
- **THEN** se infiere verify y `verifySource: "inferido"`

#### Scenario: Sin verify inferible (reliability.test.mjs)
- **WHEN** no hay verify ni inferencia posible
- **THEN** el lanzamiento falla con `E_TASK_INVALID`

### Requirement: FR-RL-03 Criterios accept
The system SHALL admitir `accept: [...]` con `cmd`, `grep` (pattern, path, absent opcional) y `file` (exists), comprobados en el worktree sin shell y paths confinados al worktree.

#### Scenario: grep y file en evidence (reliability.test.mjs)
- **WHEN** la tarea declara criterios grep y file
- **THEN** cada resultado aparece en `evidence` tras verify

#### Scenario: Symlink fuera del worktree (reliability.test.mjs)
- **WHEN** un criterio apunta fuera del worktree vía symlink
- **THEN** el criterio falla de forma segura

### Requirement: FR-RL-04 Reparación automática acotada
The system SHALL ante fallo de verify o criterio enviar a la misma sesión el error íntegro (con ref al log si se recorta), volver a "trabajando", hasta `maxRepairs` (default 2) persistido e idempotente tras reinicio del hub.

#### Scenario: Máximo de reparaciones (reliability.test.mjs)
- **WHEN** se agotan los intentos de reparación
- **THEN** la tarea queda "verificación fallida" en bandeja

#### Scenario: Reinicio hub (reliability.test.mjs)
- **WHEN** el hub se reinicia a mitad de reparación
- **THEN** no se duplica el send de reparación