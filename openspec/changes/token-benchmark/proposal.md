# Proposal

## Why

"Token minimizing" es la promesa central de Silka, pero hoy el ahorro solo está estimado (~91% sobre
definiciones de herramientas, por caracteres/4) y la meta de v1 (NFR-TOK-01, ≥ 70% menos tokens de entrada del
manager) nunca se midió con trabajo real. Sin un número medido, la afirmación no se puede sostener ni usar para
decidir.

## What Changes

- Un benchmark reproducible que corre las mismas N tareas por dos caminos: el manager trabajando solo y el
  manager delegando con Silka (Code Mode), y compara tokens, costo y calidad.
- Los tokens salen de lo que reporta el proveedor (uso real de la API), nunca de una estimación; si un camino no
  reporta uso, el resultado lo dice y no se calcula ahorro.
- La calidad se mide con la misma vara en los dos caminos: verify a la primera, reparaciones, roturas al
  mezclar y archivos fuera de alcance.
- Un informe en Markdown con la tabla comparativa, el ahorro y sus límites, guardado en `docs/benchmarks/`.

**Fuera de alcance:** comparar con otras herramientas (gentle-ai, Conductor); optimizar el ahorro (esto solo lo
mide); medir los tokens internos de cada agente delegado.

## Capabilities

### New Capabilities

- `token-benchmark`: medición reproducible del ahorro de tokens del manager y de la calidad, delegando con Silka
  frente a trabajar solo.

### Modified Capabilities

(ninguna)

## Impact

- Nuevo `scripts/benchmark/` y `docs/benchmarks/`.
- Usa `src/silka/metrics/` (fuente de cada cifra) y el registro de uso de tokens del proveedor.
- Consume cuota real: cada corrida ejecuta las tareas dos veces.
