# Proposal

## Why

Varios fallos de hoy se habrían detectado en segundos con un diagnóstico: la carpeta de worktrees fuera de
`allowedWorkspaces` (BUG-08), varios hubs a la vez (BUG-04), un bridge con código viejo, worktrees huérfanos o el
registro de repos lleno de temporales. Hoy hay que investigar a mano cada vez.

## What Changes

- Comando `silka doctor` que revisa el entorno y dice, por cada punto, si está bien, qué falla y cómo arreglarlo.
- Puntos: versión de Node; agent-rack instalado y su config; carpeta de worktrees permitida; un solo hub vivo y
  respondiendo; bridges vivos y si corren código anterior al último cambio; CLIs de los agentes instalados y con
  sesión iniciada; worktrees huérfanos y enlaces de `node_modules`; registro de repos; tamaño de notas y logs.
- Solo lee: nunca arregla nada por su cuenta. Con `--json` devuelve el resultado para que lo use el manager.

**Fuera de alcance:** arreglos automáticos (`--fix`); diagnóstico de los proyectos del usuario.

## Capabilities

### New Capabilities

- `doctor`: diagnóstico de solo lectura del entorno de Silka con causa y arreglo sugerido por punto.

### Modified Capabilities

(ninguna)

## Impact

- `src/silka/cli.mjs` (nuevo subcomando) y un módulo `src/silka/doctor/`.
- Lee `hub.log`, el registro de repos, el runtime de agent-rack y la carpeta de worktrees; no escribe nada.
