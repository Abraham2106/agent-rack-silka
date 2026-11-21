# F4: Cola de mezcla con re-verificación

- Estado: Spec escrita, pendiente de aprobación
- Decisiones: ADR-0006, ADR-0005, ADR-0007
- Depende de: F2, F3, H1

## 1. Objetivo
Mezclar lo aprobado sin romper la rama principal: una tarea a la vez, re-verificada sobre el estado real, y devolviendo los fallos a su agente.

## 2. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-MQ-01 | Un solo dueño de la cola: el hub con el lease vigente y un *fencing token* creciente. Toda operación de mezcla lleva el token. Si el token no es el vigente, la operación se aborta. |
| FR-MQ-02 | El orden es FIFO por momento de aprobación. Nadie se adelanta salvo con una acción explícita del humano. |
| FR-MQ-03 | Pasos por tarea, cada uno anotado en un **diario** (`.silka/merge-journal.jsonl`) antes y después de ejecutarse: (1) rebase de `silka/<id>` sobre la rama destino; (2) `verify` en el worktree; (3) actualización por fast-forward de la rama destino. |
| FR-MQ-04 | Un conflicto en el rebase o un `verify` fallido llevan la tarea a "reparando" y la devuelven a su sesión con el error **íntegro** (conflictos con rutas, salida de tests). La cola sigue con la siguiente. |
| FR-MQ-05 | Si la rama destino está *checked out* en el árbol del builder con cambios sin commitear, la mezcla **no toca** ese árbol: se actualiza la referencia solo si el árbol está limpio. Si no, la tarea queda "lista para mezclar" y se avisa. |
| FR-MQ-06 | Silka nunca hace `push`, `force-push`, ni reescribe historia de la rama destino. |
| FR-MQ-07 | Recuperación ante caídas: al arrancar, el dueño lee el diario y **reanuda o revierte** el paso a medias. Los pasos son idempotentes: el rebase se rehace desde la base anotada y la actualización por fast-forward se compara con el valor esperado (`git update-ref <ref> <nuevo> <viejo>`). |
| FR-MQ-08 | Al mezclar: se registra la métrica (F5), se elimina el worktree y la rama de la tarea, y se desbloquean las tareas que dependían de ella (FR-TK-03). |
| FR-MQ-09 | En el TUI y la API (`silka.merge.queue()`, `status(id)`) se ve la posición en la cola y el paso actual. |

## 3. Requisitos no funcionales
| ID | Requisito | Medida |
|---|---|---|
| NFR-QUA-02 | Roturas al mezclar | < 1 de cada 5 entregas aprobadas rompe algo; la cola lo detecta siempre antes de actualizar la rama |
| NFR-REL-01 | Corrección ante caídas | Matar el hub en cualquier paso no deja la rama destino en un estado no verificado ni mezcla dos veces |
| NFR-PERF-03 | Rendimiento de la cola | El tiempo por tarea es aproximadamente el de `verify`, más el rebase y la actualización (< 5 s) |

## 4. Seguridad
| ID | Control |
|---|---|
| SEC-06 | Git sin hooks (ver F2). |
| SEC-10 | La actualización usa compare-and-swap (`update-ref` con el valor viejo). Si alguien movió la rama, se aborta y se rehace el ciclo. |

## 5. Pruebas de aceptación
| ID | Prueba |
|---|---|
| T-MQ-01 | Dos tareas aprobadas que pasan por separado pero rompen juntas: la segunda vuelve a "reparando" y la rama destino queda verde. |
| T-MQ-02 | Inyección de fallo: matar el hub entre cada paso (después del rebase, durante `verify`, antes y después de la actualización). Al reiniciar no hay doble mezcla ni rama rota. |
| T-MQ-03 | Dos hubs a la vez: solo el del token vigente mezcla (FR-MQ-01). |
| T-MQ-04 | La rama destino tiene cambios sin commitear del builder: no se toca y se avisa. |
| T-MQ-05 | Alguien mueve la rama destino a mano durante la mezcla: se detecta por CAS y se reintenta. |
