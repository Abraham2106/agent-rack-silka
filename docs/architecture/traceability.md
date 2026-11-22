# Matriz de trazabilidad de Silka v1

Une cada **objetivo** de v1 con sus **requisitos**, las **decisiones y componentes** que lo resuelven, las **pruebas** que lo demuestran y su **estado**. Es el checkpoint vivo: se actualiza en el mismo commit que cambia el estado de una pieza.

Estados: `—` sin empezar · `Diseño` especificado · `Construcción` en curso · `Verificado` (pruebas pasan) · `Entregado`.

## 1. Objetivos de v1 → requisitos
| Objetivo (silka-v1 §5) | Requisitos |
|---|---|
| G1. Encargar 5 tareas en < 2 min con 1 llamada | FR-CM-02, FR-CM-04, FR-CM-06, FR-TK-01, FR-TK-02, FR-TK-08, NFR-PERF-01 |
| G2. Decidir cada ficha en < 1 min | FR-TK-05, FR-TK-06, FR-RV-01, FR-RV-05, FR-RV-07, NFR-UX-01, NFR-UX-02 |
| G3. < 1 de cada 5 aprobadas rompe al mezclar (y siempre se detecta) | FR-TK-04, FR-MQ-03, FR-MQ-04, NFR-QUA-02 |
| G4. ≥ 70% menos tokens de entrada con Code Mode | FR-CM-01, FR-CM-03, FR-CX-01…05, NFR-TOK-01, NFR-TOK-02 |
| G5. Calidad intacta | FR-ME-01…04, NFR-QUA-01 |
| G6. Sandbox sin fugas | SEC-01…05 |
| G7. Corrección bajo concurrencia | I-1…I-7, FR-MQ-01, FR-MQ-07, FR-RV-02 |

## 2. Requisito → spec → decisión / componente → prueba → estado
| Requisito | Spec | Decisión | Componente | Prueba | Estado |
|---|---|---|---|---|---|
| FR-CM-01 search | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | Bridge / CodeMode | T-CM-01 | Entregado |
| FR-CM-02 execute | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003, ADR-0004 | Bridge / Sandbox | T-CM-01 | Entregado |
| FR-CM-03 salida por referencia | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0002 | Almacén de referencias | T-CM-03 | Entregado |
| FR-CM-04 superficie de la API | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | API `silka` | T-CM-01 | Entregado |
| FR-CM-05 errores tipados | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | Bridge | T-SEC-01…07 | Entregado |
| FR-CM-06 esperas en el hub | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | Hub | T-CM-04 | Entregado (probado con hub falso; falta T-CM-04 con hub real) |
| FR-CM-07 compatibilidad | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | Bridge | Regresión `npm test` + smoke | Entregado |
| FR-CM-08 versión de la API | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0003 | `silka.d.ts` | T-CM-01 | Entregado |
| FR-CM-09 auditoría de ejecuciones | [code-mode](../../openspec/specs/code-mode/spec.md) | — | Bridge | T-SEC-08 | Entregado |
| FR-CM-10 wait lastMessage | [code-mode](../../openspec/specs/code-mode/spec.md) | — | CodeMode / wait-result | codemode.test.mjs | Entregado |
| FR-TK-01 worktree por tarea | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | ADR-0005 | Gestor de tareas | T-TK-01 | Entregado |
| FR-TK-02 validación de la tarea | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-TK-01 | Entregado |
| FR-TK-03 dependencias | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-TK-02 | Entregado |
| FR-TK-04 verify en el worktree | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | ADR-0005 | Gestor de tareas | T-TK-01 | Entregado |
| FR-TK-05 ficha | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | ADR-0002 | Gestor de tareas | T-RV-05 | Entregado |
| FR-TK-06 riesgo | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-TK-03 | Entregado |
| FR-TK-07 vida del worktree | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | ADR-0005 | Gestor de tareas | T-TK-05 | Entregado |
| FR-TK-08 tope de simultaneidad | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-CC-09 | Entregado |
| FR-TK-09 puertos | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-CC-09 (D-08) | Entregado (comprobación de puerto libre simplificada) |
| FR-TK-10 fuera de scope | [isolated-tasks](../../openspec/specs/isolated-tasks/spec.md) | — | Gestor de tareas | T-TK-03 | Entregado |
| FR-RL-01…04 confiabilidad | [reliability](../../openspec/specs/reliability/spec.md) | — | Gestor + bandeja | reliability.test.mjs | Entregado |
| FR-RV-01…08 bandeja | [review-inbox](../../openspec/specs/review-inbox/spec.md) | ADR-0006 | Bandeja (hub, TUI) | T-RV-01…05 | Entregado (FR-RV-07 vista TUI pendiente) |
| FR-MQ-01 dueño único y fencing | [merge-queue](../../openspec/specs/merge-queue/spec.md) | ADR-0006, ADR-0007 | Cola de mezcla | T-MQ-03 | Entregado |
| FR-MQ-02…05 pasos y fallos | [merge-queue](../../openspec/specs/merge-queue/spec.md) | ADR-0006 | Cola de mezcla | T-MQ-01, T-MQ-04 | Entregado (reorden manual FR-MQ-02 pendiente) |
| FR-MQ-06 sin push ni reescritura | [merge-queue](../../openspec/specs/merge-queue/spec.md) | ADR-0006 | Cola de mezcla | Revisión de código + T-MQ-05 | Entregado |
| FR-MQ-07 recuperación | [merge-queue](../../openspec/specs/merge-queue/spec.md) | ADR-0006 | Cola de mezcla + diario | T-MQ-02, T-CC-07 | Entregado |
| FR-MQ-08, 09 cierre y visibilidad | [merge-queue](../../openspec/specs/merge-queue/spec.md) | — | Cola de mezcla, TUI | T-MQ-01 | Entregado (vista TUI pendiente) |
| FR-IW-01…05 integración | [integration-waves](../../openspec/specs/integration-waves/spec.md) | — | integration/ | I-WV-01…05 | Entregado |
| FR-CX-01…06 contexto | [context-metrics](../../openspec/specs/context-metrics/spec.md) | ADR-0002, ADR-0009 | Paquete de contexto | T-CX-01, T-CX-02 | Entregado |
| FR-ME-01…04 métricas | [context-metrics](../../openspec/specs/context-metrics/spec.md) | ADR-0010 | Métricas | T-ME-01, T-ME-02 | Entregado (línea base con PRs reales pendiente) |
| FR-HC-01…04 reconexión hub | [hub-connection](../../openspec/specs/hub-connection/spec.md) | — | hub-link | HL-01…08 | Entregado |
| FR-UI-01…04 rendimiento TUI | [tui](../../openspec/specs/tui/spec.md) | — | ui/ | TP-01…04 | Entregado |
| NFR-TOK-01 ≥ 70% | [code-mode](../../openspec/specs/code-mode/spec.md) | ADR-0002, ADR-0003 | Code Mode | T-CM-02 | Estimado ~91% (caracteres/4, lote simulado); falta medición real T-CM-02 |
| NFR-QUA-01 calidad intacta | [context-metrics](../../openspec/specs/context-metrics/spec.md) | ADR-0010 | Métricas + línea base | T-ME-02 | Diseño |

## 3. Seguridad → amenaza → prueba
| Control | Amenazas que mitiga | Prueba | Estado |
|---|---|---|---|
| SEC-01 sin disco ni procesos | TH-01 | T-SEC-01, 02, 03 | Entregado (T-SEC-01…07 pasan) |
| SEC-02 sin red | TH-02 | T-SEC-04, 05 | Entregado (T-SEC-01…07 pasan) |
| SEC-03 límites | TH-03 | T-SEC-06, 07 | Entregado (T-SEC-01…07 pasan) |
| SEC-04 política por llamada | TH-04, TH-19 | T-CM-01 | Entregado (T-SEC-01…07 pasan) |
| SEC-05 referencias opacas | TH-05 | T-CM-03 | Entregado (T-SEC-01…07 pasan) |
| SEC-06 git sin hooks | TH-06 | T-TK-04 | Entregado (hooks fuera del repo, purgados en cada uso; T-TK-04) |
| SEC-07 verify declarado | TH-07 | T-TK-01 | Entregado (prueba explícita) |
| SEC-08 humano en riesgo alto | TH-08, TH-09 | T-RV-03 | Diseño |
| SEC-09 ficha como dato | TH-09, TH-10 | T-RV-04 | Entregado |
| SEC-10 CAS en update-ref | TH-17 | T-MQ-05 | Diseño |
| SEC-11 redacción de secretos | TH-11 | T-SEC-08 | Parcial: existe para logs e historiales |
| SEC-12 hub con token | TH-12 | T-SEC-09 | Entregado (agent-rack) |
| SEC-13 guarda de profundidad | TH-13 | T-SEC-10 | Entregado (fase 3) |
| SEC-14 alertas de presupuesto | TH-14 | — | — |

## 4. Concurrencia → corrección → prueba
| Carrera | Corrección | Prueba | Estado |
|---|---|---|---|
| C-01 robo de lock rancio | Lock rompedor `wx` + misma foto (dueño y mtime) | T-CC-01 | Entregado |
| C-02 ventana sin archivo | Rename con reemplazo sin borrar + lectura con reintento | T-CC-02 | Entregado |
| C-03 reutilización de PID | Lock renovado = vivo; PID + hora de inicio solo si caducó | T-CC-03 | Entregado |
| C-04 actualización perdida en cachés | Lock | T-CC-04 | Entregado |
| C-05 interrupción por PID | Órdenes por id de turno | T-CC-05 | Entregado |
| C-06 sesión elegida por heurística | Enlace explícito sesión ↔ turno | T-CC-06 | Entregado |
| C-07 configs externas no atómicas | Escritura atómica | Revisión | Entregado |
| D-01…D-13 | Ver concurrency.md §3 | T-CC-07…09, T-MQ-*, T-RV-* | Diseño |

## 5. Orden de construcción y checkpoints
| Paso | Pieza | Requisito de salida | Estado |
|---|---|---|---|
| 1 | H1: correcciones de concurrencia | T-CC-01…06 pasan | Entregado (0 fallos en 8 corridas de estrés) |
| 2 | F1: Code Mode | T-CM-*, T-SEC-01…07 pasan; NFR-TOK-01 medido | Entregado (49/49); medición real de tokens pendiente |
| 3 | F2: tareas aisladas | T-TK-* pasan | Entregado (60/60; e2e con hub falso) |
| 4 | F3: bandeja | T-RV-* pasan | — |
| 5 | F4: cola de mezcla | T-MQ-*, T-CC-07 pasan | — |
| 6 | F5: contexto y métricas | T-CX-*, T-ME-* pasan; línea base hecha (G4, G5) | — |
| 7 | QA final contra la sección 1 | Los 7 objetivos verificados | — |

Regla de commits: un commit por pieza **implementada** (H1, F1…F5), que actualiza esta matriz y la tabla de checkpoints de [README.md](README.md). La documentación se versiona en commits generales.
