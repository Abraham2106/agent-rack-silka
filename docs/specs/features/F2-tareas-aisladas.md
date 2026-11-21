# F2: Tareas aisladas, verificación y fichas de entrega

- Estado: Spec escrita, pendiente de aprobación
- Decisiones: ADR-0005, ADR-0002, ADR-0010
- Depende de: H1, F1 (para el lanzamiento en lote; también usable sin F1)

## 1. Objetivo
Que cada tarea delegada trabaje aislada, se verifique sola al terminar y llegue al builder como una **ficha** que se puede decidir sin abrir el transcript.

## 2. Modelo de tarea
| Campo | Obligatorio | Descripción |
|---|---|---|
| `title` | sí | Qué hacer, en 1 línea |
| `scope` | sí | Rutas o globs que puede tocar |
| `deliver` | sí | Qué debe existir al final |
| `verify` | sí | Comandos del proyecto que deben pasar (por ejemplo `npm test -- users`) |
| `agent`, `model` | no | Si faltan, se usan los de la configuración |
| `dependsOn` | no | Ids de tareas que deben estar **mezcladas** antes de empezar |
| `ports` | no | Cantidad de puertos que la tarea necesita; se asignan por tarea |

## 3. Máquina de estados
```
planificada ─► esperando dependencias ─► trabajando ─► verificando ─► lista para revisión
                                             ▲              │                │
                                             │              ▼                ▼
                                             └──── reparando ◄── verificación fallida
lista para revisión ─► aprobada (F3) ─► en cola de mezcla (F4) ─► mezclada
                   ├─► rechazada ─► trabajando (misma conversación)
                   └─► descartada
```
Las transiciones solo las ejecuta el hub, como escritor único del estado de tareas. Cada transición se registra con fecha y causa.

## 4. Requisitos funcionales
| ID | Requisito |
|---|---|
| FR-TK-01 | Al lanzar, se crea la rama `silka/<id>` desde el commit base y el worktree en `.silka/worktrees/<id>`. La sesión del agente corre con ese directorio de trabajo. |
| FR-TK-02 | La tarea se valida contra el modelo de §2. Si falta un campo obligatorio, se rechaza con `E_TASK_INVALID` antes de crear nada. |
| FR-TK-03 | Una tarea con `dependsOn` no empieza hasta que todas sus dependencias estén **mezcladas**. Si una dependencia se descarta, la tarea queda bloqueada y se avisa. |
| FR-TK-04 | Al terminar el turno del agente, el hub corre `verify` dentro del worktree, con tiempo límite y salida guardada por referencia (`log:<id>#verify`). |
| FR-TK-05 | La ficha contiene: qué cambió (declarado por el agente), archivos tocados (de `git diff` contra la base, no del agente), resultado de `verify`, resumen del diff (archivos, +/−), preguntas abiertas y riesgo. |
| FR-TK-06 | El riesgo es **alto** si: falla `verify`, hay cambios fuera de `scope`, se tocan archivos sensibles (CI, `.github/`, scripts de `package.json`, lockfiles, archivos de configuración de seguridad o `.silka/`) o el diff supera 400 líneas. Es **medio** si el diff supera 120 líneas. En otro caso es **bajo**. |
| FR-TK-07 | El worktree y la rama se eliminan **solo** al mezclar o descartar, y nunca mientras la sesión siga viva. |
| FR-TK-08 | Hay un tope de tareas simultáneas (`maxConcurrentTasks`, por defecto 5). Las demás esperan en orden. |
| FR-TK-09 | Si la tarea pide puertos, se asignan puertos libres y se pasan como `SILKA_PORT_1..n`. No se reutilizan mientras la tarea viva. |
| FR-TK-10 | Los cambios fuera de `scope` no se bloquean (el agente puede necesitarlos), pero se marcan en la ficha y suben el riesgo. |

## 5. Requisitos no funcionales
| ID | Requisito | Medida |
|---|---|---|
| NFR-UX-01 | Decidir una ficha | < 1 min sin abrir el transcript |
| NFR-PORT-01 | Plataformas | Windows, macOS y Linux. Rutas con espacios y fines de línea CRLF soportados |
| NFR-DISK-01 | Uso de disco | Tope de worktrees vivos = `maxConcurrentTasks` + tareas listas para revisión. Se avisa si se supera |

## 6. Seguridad
| ID | Control |
|---|---|
| SEC-06 | Silka ejecuta git **siempre** con `-c core.hooksPath=<vacío>`. Un agente que escriba hooks no consigue que el hub los ejecute. |
| SEC-07 | `verify` solo ejecuta los comandos declarados en la tarea por quien la creó, nunca comandos sugeridos por el agente en su salida. |
| SEC-08 | Los cambios a archivos sensibles (FR-TK-06) se marcan como riesgo alto **y** no pueden aprobarse por el manager sin humano (ver F3). |

## 7. Pruebas de aceptación
| ID | Prueba |
|---|---|
| T-TK-01 | Tres tareas paralelas en el mismo repo no se pisan; cada ficha lista solo sus archivos. |
| T-TK-02 | Tarea con `dependsOn`: no empieza hasta que se mezcla su dependencia. |
| T-TK-03 | Tarea que toca `.github/workflows`: riesgo alto. |
| T-TK-04 | Agente que escribe un hook en `.git/hooks`: el hub no lo ejecuta (SEC-06). |
| T-TK-05 | Mientras la sesión vive, el worktree no se elimina ni siquiera si se pide descartar; primero se cancela la sesión. |
