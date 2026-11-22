# Proposal

## Why

Poner Silka en una máquina nueva exige varios pasos a mano: saber qué agentes hay, generar la config efectiva de
agent-rack, registrar el bridge MCP. `silka doctor` ya diagnostica el entorno pero no lo prepara. Un comando que
muestre qué cambiaría antes de tocar nada reduce errores sin arriesgar la config global del usuario.

## What Changes

- `silka setup`: detecta agentes instalados (codex, opencode, cursor) con la misma lógica que doctor.
- Calcula lo que habría que escribir (config efectiva de Silka y entrada del bridge MCP) y muestra un diff.
- Por defecto es `--dry-run` y no escribe nada; solo `--apply` escribe, y solo en la carpeta de config de Silka.
- Idempotente: una segunda ejecución con `--apply` no cambia nada y lo dice.
- Salida `--json` para el manager.

**Fuera de alcance:** instalar los CLIs de los agentes; editar la config global de agent-rack, de Claude o de
cualquier agente; crear cuentas o iniciar sesión; actualizar versiones.

## Dependencias

Reutiliza `silka doctor` (ya archivado). No depende de `model-routing`, `role-skills` ni `review-guardrails`.

## Capabilities

### New Capabilities

- `setup`: preparación de la config efectiva de Silka y del bridge MCP, con vista previa y aplicación explícita.

### Modified Capabilities

(ninguna)

## Impact

- Módulo nuevo `src/silka/setup/` y subcomando en `src/silka/cli.mjs`; extrae de `src/silka/doctor/checks.mjs` la
  detección de agentes para compartirla.
- Escribe solo bajo `~/.config/silka/`.
