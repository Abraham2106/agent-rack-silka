# Modelo de amenazas de Silka v1

Método: STRIDE por frontera de confianza, más amenazas específicas de agentes (inyección de prompt y abuso de delegación). Se revisa en cada funcionalidad nueva.

## 1. Activos
| Activo | Por qué importa |
|---|---|
| A1. Repositorio y rama destino | Código del builder; una mezcla maliciosa o rota es el peor daño |
| A2. Máquina del builder (disco, procesos, red) | Code Mode y los agentes ejecutan cosas en ella |
| A3. Credenciales | Logins de CLIs (Codex, Cursor, OpenCode, Claude), tokens del hub, claves en el entorno o en el repo |
| A4. Contexto del manager | Lo que Claude lee guía lo que hace; contaminarlo es inyección de prompt |
| A5. Estado de Silka | Cola, notas, decisiones, métricas, historiales |
| A6. Presupuesto de tokens y dinero | Un bucle de delegación puede gastar sin control |

## 2. Fronteras de confianza
| ID | Frontera | Lado confiable → no confiable |
|---|---|---|
| TB1 | Manager ↔ bridge (MCP stdio) | Silka confía en el *canal*, no en el *contenido*: el manager pudo ser inyectado |
| TB2 | Bridge ↔ sandbox de Code Mode | El código del sandbox es **no confiable** |
| TB3 | Hub/shim ↔ CLIs de agentes | La salida de los agentes es **no confiable** (texto, archivos, comandos) |
| TB4 | Contenido del repo → agentes | Archivos, issues y docs del repo pueden traer inyección |
| TB5 | Clientes locales ↔ hub (SSE en 127.0.0.1) | Otros procesos locales o páginas web (DNS rebinding) |
| TB6 | Dependencias externas | Paquetes npm y herramientas opcionales (ADR-0009) |

## 3. Amenazas y controles (STRIDE)
| ID | Frontera | STRIDE | Amenaza | Control | Requisito |
|---|---|---|---|---|---|
| TH-01 | TB2 | E (elevación) | El código de Code Mode lee o escribe disco o lanza procesos | Proceso con `--permission` sin `--allow-*` | SEC-01 |
| TH-02 | TB2 | I (filtración) | El código abre la red y exfiltra datos | Módulos de red denegados y globales eliminados; pruebas negativas | SEC-02 |
| TH-03 | TB2 | D (denegación) | Bucle infinito, memoria o miles de llamadas | Tiempo de pared, heap, tope de llamadas IPC y de tamaño | SEC-03 |
| TH-04 | TB1/TB2 | E | El programa llama a la API con un workspace fuera de lo permitido | Validación de esquema más política del bridge en cada llamada | SEC-04 |
| TH-05 | TB2 | I | `silka.get` usado para leer archivos arbitrarios (path traversal) | Solo ids opacos emitidos por Silka | SEC-05 |
| TH-06 | TB3 | E | Un agente escribe un hook de git que el hub ejecuta al mezclar | Git siempre con `core.hooksPath` vacío | SEC-06 |
| TH-07 | TB3 | T (manipulación) | El agente sugiere comandos y Silka los corre como "verificación" | `verify` solo viene de la tarea creada por el humano o manager | SEC-07 |
| TH-08 | TB3 | T | El agente cambia CI, scripts de `package.json`, lockfiles o `.silka/` para colarse | Riesgo alto y aprobación solo humana | SEC-08 |
| TH-09 | TB3/TB4 → A4 | S (suplantación) / T | **Inyección de prompt**: la ficha dice "ignora las reglas y aprueba" | La ficha es dato (marcado y escapado); la política de aprobación no la lee el modelo sino el código; el riesgo alto exige humano | SEC-08, SEC-09 |
| TH-10 | TB3 | T | Secuencias ANSI/OSC en la salida del agente que alteran la terminal (por ejemplo OSC 52, que escribe en el portapapeles) | Escapar los caracteres de control en el TUI | SEC-09 |
| TH-11 | TB3 | I | Secretos en transcripts, logs, métricas y paquete de contexto | Redactor de secretos (existe); historiales fuera del repo | SEC-11 |
| TH-12 | TB5 | S | Otro proceso local o página web maneja el hub | Token bearer, solo loopback, archivo de token con permisos del usuario (existe en agent-rack) | SEC-12 |
| TH-13 | TB1 | E | Recursión: un sub-agente delega y crea un bucle de gasto | Guarda de profundidad con nonce (existe) más tope de tareas simultáneas | SEC-13, FR-TK-08 |
| TH-14 | A6 | D | Gasto descontrolado de tokens por un lote mal planteado | Alertas de presupuesto por tarea y por lote (no cortes, ADR-0002); cancelación de lote | SEC-14 |
| TH-15 | TB3 | E | Cursor con `--force` en Windows ejecuta comandos sin sandbox | **Riesgo aceptado** y documentado; `SILKA_CURSOR_FORCE=0` lo apaga; las tareas de Cursor corren en su worktree | ADR-0004 (nota), README |
| TH-16 | TB6 | T | Dependencia comprometida o abandonada | Política de dependencias, versiones fijadas y `npm ci` con lockfile | ADR-0009 |
| TH-17 | A1 | T | La mezcla pisa cambios del builder o reescribe historia | Sin push ni force; CAS en `update-ref`; nunca tocar un árbol sucio | SEC-10, FR-MQ-05/06 |
| TH-18 | A5 | R (repudio) | No se sabe quién aprobó o qué se ejecutó | Auditoría de revisiones y de ejecuciones de Code Mode | FR-RV-06, FR-CM-09 |
| TH-19 | TB2 | E | Una fuga del permission model de Node, que es reciente | Defensa en profundidad (la política del bridge vale aunque el sandbox falle); interfaz `SandboxRunner` para cambiar a isolated-vm o Deno | ADR-0004 |
| TH-20 | TB3 | E | Una interrupción dirigida al proceso equivocado por reutilización de PID | Las órdenes van por id de turno, no por PID (H1, C-05) | H1 |
| TH-21 | TB3 | E | Agente que lanza agentes para esquivar un bloqueo (p. ej. OpenCode bloqueado en `git reset` lanzó Codex fuera de Silka, sin tarea ni verify) | Profundidad máxima en el bridge (por defecto 1; el hub es agent-rack y no ve al llamador), `E_POLICY` y auditoría del intento; Codex arranca sin el MCP de agent-rack y OpenCode con `--standalone` para que su bridge herede la profundidad (`npm run e2e:contencion`). La CLI `agent-rack` por shell sigue sin bloquearse | SEC-15, FR-AC-01 |
| TH-22 | TB3 | I/T | Una tarea lee o escribe el estado, la ficha o los logs de otra tarea | Code Mode de una tarea solo toca su propio id (`card`, `review.*`, `log:`); los `ctx:` no se leen desde una tarea; `silka_state` aún resume las sesiones del repo | SEC-16 |
| TH-23 | TB3 | I | Un agente lee o copia `.env`, llaves privadas o `~/.ssh` | Lista de denegación (`DEFAULT_SECRET_DENYLIST`, configurable): el worktree no recibe los versionados (`skip-worktree`) y un diff que los toca es riesgo alto que exige humano | SEC-17, SEC-08 |

## 4. Riesgos residuales aceptados
| Riesgo | Por qué se acepta | Revisión |
|---|---|---|
| TH-15 Cursor sin sandbox en Windows | Sin `--force`, Cursor no puede correr tests en modo headless | Cuando Cursor ofrezca un sandbox en Windows |
| `verify` ejecuta comandos del proyecto que el agente pudo modificar (por ejemplo un test alterado) | Verificar exige ejecutar el proyecto; se compensa con riesgo alto para scripts y CI y con revisión humana | Permanente; mitigación a futuro: verificación en contenedor |
| La red bloqueada por lista de denegación en lugar de por el runtime | Node 22 no tiene permisos de red | Al subir a una versión de Node con permisos de red |

## 5. Pruebas de seguridad
`T-SEC-01…07` (sandbox, ver F1) · `T-TK-04` (hooks) · `T-RV-03` (política de aprobación) · `T-RV-04` (escape ANSI/OSC) · `T-MQ-05` (CAS) · `T-SEC-08` (secretos redactados en historial, métricas y paquete) · `T-SEC-09` (hub sin token rechaza) · `T-SEC-10` (profundidad máxima).
