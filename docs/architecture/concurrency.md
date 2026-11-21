# Concurrencia y condiciones de carrera

Silka tiene muchos procesos sobre el mismo estado: el hub, un shim por turno de agente, un bridge por cliente MCP, el sandbox de Code Mode, el TUI y la CLI. Este documento hace el inventario de los recursos compartidos, analiza las carreras **existentes** (revisadas en el código de la rama `silka-roadmap`, commit `2d91b68`) y las **de diseño** de F1–F5, y fija los invariantes y las pruebas.

## 1. Recursos compartidos
| Recurso | Escritores | Lectores | Mecanismo actual |
|---|---|---|---|
| `~/.config/silka/queue/<sesión>.json` | CLI, TUI, bridge (encolar), hub (despachar) | Todos | Lock por archivo + escritura atómica |
| `~/.config/silka/notes.jsonl` | CLI, TUI, bridge, despachador | Bridge, TUI | Lock + atómica |
| `~/.config/silka/sessions.json` (orígenes) | Bridge | TUI, CLI | Lock + atómica |
| `<ws>/.silka/tasks.json` | Shims (inicio y fin de turno) | Shims, TUI, bridge | Lock por workspace + atómica |
| `~/.config/silka/transcripts/*.jsonl` | Shim | TUI | Lock + anexado |
| `~/.config/silka/interrupt/<pid>` | TUI, CLI, bridge | Shim (sondeo) | Atómica, **sin lock** |
| Cachés de modelos (`models*.json`) | Shims, CLI, TUI | Todos | Atómica, **sin lock** |
| `agent-rack.config.json` | `setup`, `silka models default` | Hub, shim, CLI | Atómica, **sin lock** |
| Configs externas (`~/.cursor/mcp.json`, etc.) | `silka connect` | La CLI dueña | **Escritura directa** |
| Sesiones de agent-rack (memoria del hub) | Hub | Todos vía SSE | Un solo proceso |
| Repositorio git (F2–F4) | Agentes (worktrees), hub (mezcla) | Todos | — (diseño en §3) |

## 2. Carreras existentes (encontradas en el código)

| ID | Severidad | Dónde | Carrera | Escenario | Corrección (H1) |
|---|---|---|---|---|---|
| **C-01** | Alta | `lock.mjs` `withFileLock` | **Robo de lock rancio (TOCTOU)** | A y B ven al dueño muerto → A borra el lock → A lo crea (`wx`) → B borra el lock **de A** → B lo crea → A y B dentro de la sección crítica a la vez | Romper el lock renombrándolo a un nombre único (`rename` es atómico) y verificar que el contenido renombrado es el del dueño muerto que se vio; si no coincide, devolverlo. O un lock con *token*: solo borra quien comprueba el mismo token bajo el rename |
| **C-02** | Media | `lock.mjs` `writeAtomic` (Windows) | **Ventana sin archivo** | `rmSync(file)` y después `renameSync(tmp, file)`: durante el hueco, un lector sin lock ve el archivo ausente y lo interpreta como estado vacío (`readStore` devuelve vacío y el bloque de estado sale sin tareas) | En Windows, `fs.renameSync` sí reemplaza si el destino no está abierto; reintentar el rename sin borrar antes y, como último recurso, `copyFile` sobre el destino. Los lectores tratan "ausente" como "reintentar una vez" |
| **C-03** | Media | `lock.mjs` `lockHolderDead` | **Reutilización de PID** | El dueño murió y Windows reutilizó su PID en otro proceso: el lock parece vivo para siempre y bloquea hasta el tiempo límite | Guardar en el lock el PID **y** la hora de inicio del proceso; un PID vivo con otra hora de inicio cuenta como muerto. Tope de antigüedad basado en el `mtime` (el dueño lo renueva cada segundo) |
| **C-04** | Baja | `models.mjs` | **Actualización perdida** | Dos shims marcan a la vez distintos modelos como no disponibles: cada uno lee, añade y escribe, y uno pierde su marca | Envolver el *read-modify-write* en `withFileLock` |
| **C-05** | Media | `interrupt.mjs` + shim | **Orden al proceso equivocado** | La orden se indexa por PID del shim. Si el shim ya terminó y el PID se reutilizó en otro shim, la orden interrumpe otra sesión | Indexar las órdenes por **id de turno** (el `task.id` de `.silka`), que es único; el shim solo acepta órdenes con su id |
| **C-06** | Media | `interrupt.mjs` `shimPidForSession` | **Selección heurística** | Con dos sesiones del mismo agente en el mismo workspace, se elige la de inicio más cercano y puede interrumpir la otra | Enlace explícito sesión ↔ turno, registrado cuando se crea la sesión (el bridge o la CLI escriben el id de turno esperado), sin heurística |
| **C-07** | Baja | `connect.mjs` | **Escritura no atómica de configs externas** | Cursor lee `mcp.json` mientras se escribe y ve JSON a medias | Escritura atómica (temporal + rename) |
| **C-08** | Baja | `hub.mjs` `ensureHub` | **Arranque doble** | Dos `silka ui` simultáneos ven "sin hub" y ambos lanzan uno; el segundo falla al tomar el puerto | Aceptable hoy (el puerto actúa de mutex). Con F4 el dueño de la cola usa además el fencing token (FR-MQ-01) |

**Verificado como correcto (no-riesgo):** la entrega de la cola de mensajes es *exactamente una vez*. `takeForDelivery` marca `delivering` con el `turnCount` base, y si el turno avanzó el lote se da por entregado. El despachador salta las sesiones ocupadas, así que un `sendInput` que tuvo éxito antes de una caída no se repite (QA del chat, test "nada se entrega dos veces").

## 3. Carreras de diseño en F1–F5 y cómo se evitan

| ID | Funcionalidad | Carrera posible | Diseño que la evita |
|---|---|---|---|
| D-01 | F3 | Aprobar y descartar la misma tarea a la vez (TUI y manager) | Escritor único de estados de tarea (el hub). Las acciones llevan la `version` vista: la segunda acción ve otra versión y recibe `E_STALE` |
| D-02 | F3 | Aprobar una versión vieja mientras el agente re-entrega | Versión monotónica por tarea; aprobar exige `version == actual` |
| D-03 | F4 | Dos hubs mezclando a la vez | Lease de dueño más **fencing token** creciente; toda operación de mezcla valida el token |
| D-04 | F4 | Caída a mitad de la mezcla | Diario *write-ahead* por paso. Pasos idempotentes. `update-ref` con CAS (valor viejo esperado) |
| D-05 | F4 | El builder mueve la rama destino a mano durante la mezcla | El CAS falla y la tarea vuelve a la cola para rehacer el rebase |
| D-06 | F2 | Borrar el worktree mientras el agente sigue escribiendo | Solo se borra al mezclar o descartar, y antes se cancela la sesión y se espera su salida (FR-TK-07) |
| D-07 | F2 | Dos tareas que dependen de la misma se desbloquean y arrancan juntas sobre un HEAD que cambió | El desbloqueo toma el commit base **en el momento de arrancar**, bajo el lock de tareas |
| D-08 | F2 | Dos tareas toman el mismo puerto | Asignación de puertos bajo lock, con un registro en `.silka/ports.json`; se liberan solo al terminar la tarea |
| D-09 | F1 | El cliente MCP se desconecta con IPC pendiente | Cancelar el sandbox; las respuestas que llegan tarde se descartan por id de ejecución; las tareas lanzadas siguen vivas (FR-CM-06, T-CM-04) |
| D-10 | F1 | `waitAll` con tareas que fallan mientras se espera | El hub resuelve cada `wait` por evento de estado (no por sondeo del modelo); un fallo es un resultado, no una excepción que aborta el lote |
| D-11 | F5 | Construir el paquete de contexto mientras otro proceso lo lee | El nombre lleva el hash del commit (inmutable); se escribe con la escritura atómica; el lector usa el archivo completo o no lo usa |
| D-12 | F5 | Métricas anexadas en paralelo por varios shims | Una línea por escritura, menor a 4 KB, con `appendFile` (anexado atómico por línea en la práctica) más un lock si la línea pudiera superar ese tamaño |
| D-13 | Interrumpir | La interrupción llega justo cuando el turno termina solo | Si el turno ya terminó, "enviar ya" se convierte en un turno normal (ya especificado). La orden se borra al consumirse o al terminar el turno |

## 4. Invariantes
| ID | Invariante |
|---|---|
| I-1 | A lo sumo un proceso dentro de cada sección crítica (un lock, un dueño) |
| I-2 | Cada mensaje encolado se entrega **exactamente una vez** o queda visible como no entregado |
| I-3 | La rama destino solo avanza a commits que pasaron `verify` en ese mismo estado |
| I-4 | Ninguna tarea se mezcla dos veces |
| I-5 | Un worktree existe mientras su sesión vive |
| I-6 | Toda transición de estado de tarea la hace el hub y queda registrada |
| I-7 | Ninguna lectura interpreta "archivo ausente por un rename en curso" como "estado vacío" |

## 5. Plan de pruebas de concurrencia
| ID | Prueba | Cubre |
|---|---|---|
| T-CC-01 | 20 procesos rompen a la vez un lock rancio; se cuenta cuántos entran simultáneamente en la sección (debe ser 1) | C-01, I-1 |
| T-CC-02 | Un lector en bucle mientras un escritor reemplaza el archivo 1.000 veces en Windows: el lector nunca ve "vacío" | C-02, I-7 |
| T-CC-03 | Lock con un PID reutilizado simulado (misma PID, otra hora de inicio): se considera rancio | C-03 |
| T-CC-04 | 10 shims marcan modelos distintos a la vez: no se pierde ninguna marca | C-04 |
| T-CC-05 | Una orden de interrupción a un turno que ya terminó no afecta a otro turno con el mismo PID | C-05 |
| T-CC-06 | Dos sesiones del mismo agente en el mismo workspace: la interrupción llega a la correcta | C-06 |
| T-CC-07 | Inyección de fallos: matar el hub en cada paso de la mezcla (F4) | D-03, D-04, I-3, I-4 |
| T-CC-08 | Aprobar y descartar a la vez desde dos clientes | D-01, I-6 |
| T-CC-09 | Estrés: 5 tareas, interrupciones aleatorias, mensajes en cola y caídas del hub; al final se comprueban I-1…I-7 | Todo |

Las pruebas multiproceso se escriben con `node:test` y procesos hijos reales, sin dependencias nuevas.
