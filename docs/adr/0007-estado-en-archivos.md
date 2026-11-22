# ADR-0007: Estado en archivos JSON/JSONL con lock y escritura atómica, sin base de datos

- Estado: Aceptada (con correcciones pendientes en H1)
- Fecha: 2026-11-21
- Relacionadas: [concurrency.md](../architecture/concurrency.md)

## Contexto
El estado (cola, notas, orígenes, tareas, historiales, métricas) lo escriben varios procesos: hub, shims, bridge, TUI y CLI. Una base de datos (SQLite) daría transacciones, pero en Node exige un módulo nativo (o `node:sqlite`, experimental en Node 22) y complica la instalación.

## Decisión
- Se mantiene el estado en archivos, con estas reglas:
  - **lock exclusivo por recurso** (`withFileLock`) para todo *read-modify-write*;
  - **escritura atómica** (temporal + rename);
  - **JSONL de solo anexar** para historiales y métricas.
- Las lecturas sin lock deben tolerar estados intermedios (archivo ausente durante un rename en Windows).
- El análisis de [concurrency.md](../architecture/concurrency.md) encontró fallos reales en esta implementación: robo de lock rancio (C-01), ventana sin archivo en Windows (C-02) y escrituras sin lock (C-04, C-05). Se corrigen en H1 **antes** de construir F2–F4 sobre esta base.

## Alternativas
- `node:sqlite`: transacciones reales y sin dependencias. Es experimental en Node 22. Se reevalúa cuando sea estable. Queda como candidato a reemplazar este ADR.
- `better-sqlite3`: maduro, pero es nativo (ADR-0009).

## Consecuencias
- (+) Cero dependencias. El estado es legible y depurable a mano.
- (−) La corrección depende de la disciplina de locks. Se exige que toda función que escriba estado pase por un módulo único (`store`) y que existan pruebas de concurrencia multi-proceso.
