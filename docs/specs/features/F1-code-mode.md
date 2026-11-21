# F1: Delegación en lote vía Code Mode

- Estado: Spec escrita, pendiente de aprobación
- Decisiones: ADR-0002, ADR-0003, ADR-0004
- Depende de: H1 (correcciones de concurrencia)

## 1. Objetivo
Que el manager (Claude u otro harness) encargue, espere y filtre el trabajo de N agentes **en una sola ida y vuelta**, viendo solo los resultados que necesita para decidir.

## 2. Alcance
**Incluye:** las herramientas `silka_search` y `silka_execute` en el bridge, la API `silka` tipada (`silka.d.ts`), el sandbox de ejecución y el almacén de salidas por referencia (`out:`).

**No incluye:** cambios en las herramientas internas de Codex, Cursor ni OpenCode, enrutamiento automático de modelos ni Code Mode para sub-agentes (queda como una extensión posible).

## 3. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-CM-01 | `silka_search(query)` devuelve solo los fragmentos de `silka.d.ts` relevantes para la consulta (firmas y su JSDoc), con un máximo de 4 KB. |
| FR-CM-02 | `silka_execute(code)` ejecuta el programa en el sandbox (ADR-0004) y devuelve su valor de retorno serializado a JSON. |
| FR-CM-03 | Si la salida supera 8 KB, se guarda completa y se devuelve `{ ref: "out:<id>", bytes, preview }`. Nunca se trunca sin referencia. |
| FR-CM-04 | La superficie de la API es la de [silka-v1 §3.1](../silka-v1.md): `plan`, `launch`, `wait`, `waitAll`, `status`, `card`, `get`, `send`, `cancel`, `review.*`, `merge.*`, `state.*`, `agents.*`. |
| FR-CM-05 | Los errores del programa vuelven íntegros: mensaje, línea del código del manager y, si viene de la API, el código de error tipado (`E_SCOPE`, `E_POLICY`, `E_LIMIT`, `E_NOT_FOUND`, `E_CONFLICT`). |
| FR-CM-06 | Las esperas largas (`wait` / `waitAll`) las resuelve el hub. El sandbox solo espera la respuesta por IPC y no consume CPU. |
| FR-CM-07 | Las herramientas MCP actuales siguen disponibles sin cambios (compatibilidad). |
| FR-CM-08 | `silka.d.ts` se versiona con semver y la versión se informa en cada respuesta de `silka_search`. |
| FR-CM-09 | Cada ejecución se registra (id, autor, duración, llamadas a la API, bytes devueltos) en la auditoría, sin el código si contiene secretos (redactado). |

## 4. Requisitos no funcionales
| ID | Requisito | Medida |
|---|---|---|
| NFR-TOK-01 | Ahorro de tokens de entrada del manager | ≥ 70% menos que con las herramientas MCP actuales para el escenario de lote (5 tareas: lanzar, esperar y fichas) |
| NFR-PERF-01 | Encargar en lote | 5 tareas lanzadas en < 2 min desde la llamada |
| NFR-PERF-02 | Arranque del sandbox | < 300 ms en la máquina de referencia |
| NFR-QUA-01 | Calidad intacta | La tasa de verificaciones aprobadas no baja frente a la línea base |

## 5. Seguridad (detalle en [security.md](../../architecture/security.md))
| ID | Control |
|---|---|
| SEC-01 | El sandbox no tiene permisos de sistema de archivos ni de procesos (`--permission` sin `--allow-*`). |
| SEC-02 | Los módulos de red y de ejecución están denegados por un hook de resolución, y los globales de red se eliminan. |
| SEC-03 | Límites por ejecución: tiempo de pared (60 s por defecto, configurable hasta 60 min solo si el programa está esperando por IPC), heap de 128 MB, 200 llamadas IPC y 1 MB de mensaje IPC. |
| SEC-04 | Toda llamada IPC se valida con un esquema y pasa por la política del bridge: `allowedWorkspaces`, profundidad y lista blanca. |
| SEC-05 | `silka.get(ref)` solo resuelve referencias emitidas por Silka (ids opacos). No acepta rutas arbitrarias. |

## 6. Comportamiento y estados de una ejecución
`recibida → validada → sandbox listo → ejecutando ⇄ esperando IPC → completada | error | excedida (límite) | cancelada`

Si el cliente MCP se desconecta, la ejecución se cancela y el proceso del sandbox se termina. Las tareas que lanzó **siguen vivas** en el hub: son trabajo legítimo, no del sandbox.

## 7. Casos de error
| Situación | Resultado |
|---|---|
| Error de sintaxis en el código | `E_SYNTAX` con línea y columna |
| Llamada a un módulo denegado | `E_POLICY: módulo 'net' no permitido en Code Mode` |
| Límite excedido | `E_LIMIT` con el límite concreto y el valor alcanzado |
| Workspace fuera de lo permitido | `E_SCOPE` |
| Hub caído | `E_HUB` con la instrucción para levantarlo |

## 8. Pruebas de aceptación
| ID | Prueba |
|---|---|
| T-CM-01 | Lote de 5 tareas con una sola llamada `silka_execute`; devuelve 5 fichas. |
| T-CM-02 | Medición de tokens del manager, Code Mode contra herramientas MCP, en el mismo lote (cumple NFR-TOK-01). |
| T-CM-03 | Salida de 50 KB: devuelve una referencia, y `silka.get` recupera la salida completa idéntica. |
| T-SEC-01…07 | Intentos de leer o escribir disco, lanzar un proceso, abrir `net`, `http` y `fetch`, cargar `vm` o `inspector`, exceder el heap y exceder las llamadas IPC: todos fallan con el error esperado. |
| T-CM-04 | Desconexión del cliente a mitad de ejecución: el sandbox termina y las tareas siguen vivas. |
