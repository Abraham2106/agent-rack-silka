# F3: Bandeja de revisión

- Estado: Spec escrita, pendiente de aprobación
- Decisiones: ADR-0002, ADR-0006
- Depende de: F2

## 1. Objetivo
Que el builder decida muchas entregas rápido y con confianza: ve lo necesario para decidir y pide el detalle solo cuando lo quiere.

## 2. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-RV-01 | La bandeja lista las tareas en "lista para revisión" y "verificación fallida", ordenadas por riesgo (alto, medio, bajo) y luego por antigüedad. |
| FR-RV-02 | Las acciones son **aprobar**, **rechazar con nota** y **descartar**. Cada una es **idempotente** y lleva el *número de versión* de la tarea que se vio. Si la tarea cambió desde entonces (por ejemplo, el agente volvió a entregar), la acción se rechaza con `E_STALE` y se refresca la ficha. |
| FR-RV-03 | Al rechazar, la nota se envía a la **misma conversación** del agente (reanudación) y la tarea vuelve a "trabajando". |
| FR-RV-04 | Al aprobar, la tarea pasa a la cola de mezcla (F4). No se mezcla en el momento. |
| FR-RV-05 | El detalle (diff, log de verificación, transcript) se carga por referencia y solo a pedido. La ficha nunca incluye el diff completo. |
| FR-RV-06 | Cada decisión se audita en `.silka/reviews.jsonl`: quién (humano o manager), cuándo, qué versión vio y qué decidió. |
| FR-RV-07 | En el TUI, `r` abre la bandeja: `a` aprueba, `x` rechaza (pide la nota), `d` descarta (pide confirmación) y `enter` abre el detalle. |
| FR-RV-08 | En la API: `silka.review.inbox()`, `approve(id, { version })`, `reject(id, note, { version })` y `discard(id, { version })`. |

## 3. Política de aprobación
| Riesgo de la ficha | ¿Quién puede aprobar? |
|---|---|
| Bajo | Humano o manager |
| Medio | Humano o manager (configurable para exigir humano) |
| Alto, o archivos sensibles (SEC-08) | **Solo humano** |

El manager nunca aprueba sus propias tareas sin verificación exitosa.

## 4. Requisitos no funcionales
| ID | Requisito | Medida |
|---|---|---|
| NFR-UX-01 | Decidir una ficha | < 1 min sin abrir el transcript |
| NFR-UX-02 | Abrir la bandeja con 50 tareas | < 1 s |

## 5. Seguridad
| ID | Control |
|---|---|
| SEC-08 | El riesgo alto exige humano (§3). |
| SEC-09 | El texto que viene del agente (resumen y preguntas) se muestra como **dato**: se escapan las secuencias de terminal (ANSI/OSC) y se marca como "dicho por el agente". Instrucciones como "aprueba esto" dentro de una ficha no tienen efecto. |

## 6. Pruebas de aceptación
| ID | Prueba |
|---|---|
| T-RV-01 | Aprobar dos veces la misma versión: la segunda es un no-op. |
| T-RV-02 | Aprobar una versión vieja tras una re-entrega: `E_STALE`. |
| T-RV-03 | El manager intenta aprobar una tarea de riesgo alto: `E_POLICY`. |
| T-RV-04 | Una ficha con secuencias ANSI/OSC en el resumen: se muestran escapadas. |
| T-RV-05 | Rechazar con nota: el agente recibe la nota en la misma conversación. |
