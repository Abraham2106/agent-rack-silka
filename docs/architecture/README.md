# Arquitectura de Silka: índice y checkpoints

Punto de entrada a la documentación de diseño. Cada funcionalidad avanza por estos estados y se actualiza aquí en el mismo commit que la cambia:

`Propuesta → Spec aprobada → En construcción → Verificada (QA) → Entregada`

## Documentos

| Documento | Qué contiene |
|---|---|
| [overview.md](overview.md) | Contexto, contenedores y componentes (C4 niveles 1–3), flujos principales y atributos de calidad |
| [../adr/](../adr/) | Registros de decisiones de arquitectura (ADR) |
| [../specs/silka-v1.md](../specs/silka-v1.md) | Visión de producto v1 y principios de ahorro de tokens por diseño |
| [../specs/features/](../specs/features/) | Spec por funcionalidad (F1–F5) con requisitos numerados |
| [security.md](security.md) | Modelo de amenazas (STRIDE), fronteras de confianza y controles |
| [atam.md](atam.md) | Architecture Trade-off Analysis Method: árbol de utilidad, enfoques, puntos de sensibilidad y de compromiso, riesgos |
| [concurrency.md](concurrency.md) | Recursos compartidos, condiciones de carrera (existentes y de diseño), invariantes y pruebas |
| [traceability.md](traceability.md) | Matriz: objetivo → requisito → decisión/componente → prueba → estado |

## Checkpoints de v1

| ID | Funcionalidad | Spec | Estado | Commit |
|---|---|---|---|---|
| F1 | Delegación en lote vía Code Mode (`silka_search` / `silka_execute`) | [F1](../specs/features/F1-code-mode.md) | Spec escrita, pendiente de aprobación | — |
| F2 | Tareas aisladas (worktree), verificación y fichas de entrega | [F2](../specs/features/F2-tareas-aisladas.md) | Spec escrita, pendiente de aprobación | — |
| F3 | Bandeja de revisión | [F3](../specs/features/F3-bandeja-revision.md) | Spec escrita, pendiente de aprobación | — |
| F4 | Cola de mezcla con re-verificación | [F4](../specs/features/F4-cola-mezcla.md) | Spec escrita, pendiente de aprobación | — |
| F5 | Contexto por referencia y métricas | [F5](../specs/features/F5-contexto-metricas.md) | Spec escrita, pendiente de aprobación | — |
| H1 | Corrección de carreras existentes (C-01…C-06 de concurrency.md) | [concurrency.md](concurrency.md) | Diagnosticada, pendiente de aprobación | — |

## Funcionalidades ya entregadas (antes de v1)

Hub y TUI · mensajes, cola y "enviar ya" · notas al manager · puente entre agentes (`silka bridge`) · estado compartido `.silka/` · Graphify opcional · catálogo de modelos · TUI estilo Antigravity · logo pixel-art. Ver el historial de git de la rama `silka-roadmap` y `docs/reports/`.
