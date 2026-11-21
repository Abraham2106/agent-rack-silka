# F5: Contexto por referencia y métricas

- Estado: Spec escrita, pendiente de aprobación
- Decisiones: ADR-0002, ADR-0010, ADR-0009
- Depende de: F2 (para medir por tarea)

## 1. Objetivo
Que cada agente arranque con el contexto **exacto y estable** que necesita (menos tokens por diseño, cacheable) y que cada tarea deje datos para saber qué funciona.

## 2. Requisitos funcionales: contexto
| ID | Requisito |
|---|---|
| FR-CX-01 | Hay un **paquete de repo** por commit base, construido una vez y cacheado en `.silka/context/<sha>.md`. Contiene: estructura del repo (directorios y archivos principales, sin contenido), convenciones (extraídas de `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` si existen), comandos de verificación y el bloque de estado. |
| FR-CX-02 | Orden fijo y estable: paquete de repo → convenciones → estado → encargo. Lo variable (el encargo) va al final, para maximizar el acierto de caché del proveedor. Sin marcas de tiempo ni datos volátiles en la parte estable. |
| FR-CX-03 | El encargo incluye **punteros**, no contenido: archivos y símbolos relevantes según `scope`, con ruta y una línea de por qué. El agente los lee si los necesita. |
| FR-CX-04 | Todo lo que Silka no copia al contexto se puede recuperar por referencia (`silka.get(ref)`), completo y sin pérdida. |
| FR-CX-05 | Si el paquete supera su presupuesto, se omiten secciones **enteras** de menor prioridad (nunca se corta una a la mitad) y se deja un puntero a la versión completa. |
| FR-CX-06 | Proveedores de contexto opcionales (Graphify hoy; Serena o cxpak a futuro, según ADR-0009) se conectan detrás de la interfaz `ContextProvider` y se pueden apagar. |

## 3. Requisitos funcionales: métricas
| ID | Requisito |
|---|---|
| FR-ME-01 | Por cada tarea se anexa a `.silka/metrics.jsonl`: id, agente, modelo, tokens de entrada, salida y caché, turnos, duración, resultado de `verify`, si se aprobó a la primera, si rompió al mezclar, interrupciones y la **fuente** de cada número. |
| FR-ME-02 | Un dato que la CLI no reporta queda `null` con la fuente "sin dato". Nunca se estima en silencio (ADR-0010). |
| FR-ME-03 | `silka.agents.stats(agent?, model?)` y la vista `m` del TUI agregan por agente y modelo: éxito a la primera, tokens medianos y tiempo mediano. |
| FR-ME-04 | Hay un procedimiento de **línea base**: repetir N PRs reales del repo con y sin Code Mode y paquete de contexto, en un checkout limpio, y comparar tokens y tasa de `verify` (NFR-TOK-01 y NFR-QUA-01). |

## 4. Requisitos no funcionales
| ID | Requisito | Medida |
|---|---|---|
| NFR-TOK-02 | Acierto de caché del prefijo estable | Se registra cuando el proveedor lo informa (Codex lo hace) y es la métrica de seguimiento del FR-CX-02 |
| NFR-QUA-01 | Calidad intacta | La tasa de `verify` aprobados no baja frente a la línea base |

## 5. Seguridad
| ID | Control |
|---|---|
| SEC-11 | El paquete de repo y las métricas pasan por el redactor de secretos antes de escribirse. Las convenciones se citan del repo, no se generan. |
| SEC-05 | Las referencias son ids opacos emitidos por Silka. No se resuelven rutas arbitrarias. |

## 6. Pruebas de aceptación
| ID | Prueba |
|---|---|
| T-CX-01 | Dos tareas sobre el mismo commit base usan el mismo paquete (mismo hash) y en el mismo orden. |
| T-CX-02 | Paquete sobre presupuesto: se omiten secciones enteras con un puntero; no hay cortes a la mitad. |
| T-ME-01 | Una tarea de cada agente deja su registro con fuente. Si un dato falta, queda `null` y "sin dato". |
| T-ME-02 | El procedimiento de línea base produce una tabla comparable (tokens y tasa de `verify`) para 5 PRs. |
