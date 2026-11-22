# Silka v1: delegar mucho a la vez, recibirlo bien hecho, con menos tokens por diseño

Estado: propuesta para aprobación.

## 1. Tesis

Cuando delegas muchas tareas en paralelo, escribir código deja de ser el cuello de botella. El cuello de botella eres tú en dos momentos:

1. **Encargar:** escribir N encargos, elegir agente y modelo, lanzarlos.
2. **Revisar:** leer N transcripts o diffs, decidir si cada cosa quedó bien, mezclar sin conflictos.

Las herramientas que ya existen (Conductor, Emdash, Superset, subagentes de Claude Code, background agents de Cursor) resuelven *lanzar en paralelo*. Silka v1 resuelve *encargar en lote y revisar en lote con confianza*, y lo hace gastando menos tokens **por cómo está diseñado el sistema, no porque recorte información**.

## 2. Principio rector: ahorro por arquitectura, nunca por recorte

Regla: **el modelo recibe resultados, no procesos.** Todo lo que se puede hacer de forma determinista lo hace el sistema, y el modelo solo ve lo que necesita para decidir. Nada útil se pierde: lo que no entra al contexto queda guardado y se pide por referencia.

| # | Principio | Qué significa en Silka | Qué NO se hace |
|---|---|---|---|
| P1 | **Los datos se quedan donde se producen** | Transcripts, logs, diffs y salidas de tests viven en el hub y en `.silka/`. Al contexto sube el resultado ya filtrado por código. | Pegar logs en el contexto "por si acaso". |
| P2 | **Por referencia, no por copia** | Todo tiene un id (`task:3f2a`, `diff:3f2a`, `log:3f2a#tests`). El modelo pide el detalle solo si lo necesita. | Resumir algo de forma irreversible. Siempre se puede recuperar el original. |
| P3 | **Interfaces mínimas y estables** | 2 herramientas (Code Mode) en lugar de ~20, con una API tipada que se descubre bajo demanda. | Cargar todas las definiciones de herramientas en cada turno. |
| P4 | **Lo determinista lo hace el código** | Esperar, sondear, correr tests, `git diff`, ordenar, mezclar, re-verificar: todo eso es código, no turnos del modelo. | Usar un turno del modelo para "revisar si ya terminó". |
| P5 | **Una ida y vuelta por intención** | "Lanza estas 5, espera y tráeme las fichas" es una sola llamada. | 20 llamadas encadenadas que pasan por el contexto. |
| P6 | **Contexto exacto, no voluminoso** | Mapa del repo más punteros; el agente trae el símbolo o la función exacta. | Leer archivos enteros o el repo completo. |
| P7 | **Nunca se comprime la señal** | Código, requisitos, errores y diffs se pasan íntegros cuando se piden. Solo se filtra el ruido: barras de progreso, logs repetidos, tests que pasaron. | Truncar un error o un requisito para ahorrar. |
| P8 | **Tokens y calidad se miden juntos** | Cada optimización se valida contra la tasa de aprobación de las verificaciones (repitiendo PRs reales). Si la calidad baja, se revierte. | Celebrar un ahorro sin medir la calidad. |

## 3. Las 4 piezas de v1

### 3.1 Delegación en lote vía Code Mode (sinergia con Cloudflare / Anthropic)

**Idea.** Igual que el Code Mode de Cloudflare y el *code execution with MCP* de Anthropic, Silka deja de exponer ~20 herramientas MCP y expone **2**:

- `silka_search(query)`: devuelve solo las firmas TypeScript relevantes de la API de Silka (descubrimiento progresivo).
- `silka_execute(code)`: ejecuta un programa corto contra la API `silka` en un sandbox y devuelve **solo** lo que el programa retorna.

Las herramientas actuales (`agent_run`, `agent_session_*`, `silka_*`) siguen disponibles para clientes que no usen Code Mode. Code Mode es una capa encima, no un reemplazo.

**Por qué no baja la calidad.** Los modelos escriben llamadas más precisas en TypeScript (lo han visto mucho más que ejemplos de *tool calls*). Además, el filtrado lo hace un código explícito, que el modelo escribió y puede leer, no una heurística opaca. Lo intermedio no se pierde: queda accesible por id.

**Ejemplo: lo que hoy son unas 20 llamadas, en una sola.**

```ts
const plan = await silka.plan.fromFile('docs/tasks/sprint-12.md'); // tareas + dependencias
const tasks = await silka.launch(plan, { isolate: 'worktree' });   // N sesiones en paralelo
const done = await silka.waitAll(tasks, { timeoutMin: 45 });       // esperar es código, no turnos
const cards = done.map((t) => silka.card(t.id));                   // ficha de ~200 tokens c/u
return cards.filter((c) => c.gates !== 'pass' || c.risk === 'alto'); // solo lo que necesita atención
```

**API v1 (superficie mínima, tipada):**

| Módulo | Funciones |
|---|---|
| `silka.plan` | `fromFile(path)`, `fromList(items)`: tareas con `{ title, scope, deliver, verify, agent?, model?, dependsOn? }` |
| `silka` | `launch(planOrTask, opts)`, `wait(id)`, `waitAll(ids, opts)`, `status(id)` |
| `silka` | `card(id)`: ficha de entrega. `get(ref)`: detalle por referencia (`diff:`, `log:`, `transcript:`, con rango) |
| `silka` | `send(id, text, { now })`: cola o "enviar ya". `cancel(id)` |
| `silka.review` | `inbox()`, `approve(id)`, `reject(id, note)`, `discard(id)` |
| `silka.merge` | `queue()`, `status(id)` |
| `silka.state` | `summary()`, `changes(since)`, `decide(text)` |
| `silka.agents` | `list()`, `models(agent)`, `stats(agent, model)` (del marcador) |

**Implementación del sandbox (sin dependencias nuevas; verificado en Node 22.22 de esta máquina):**

1. `silka_execute` lanza un proceso hijo `node --permission` **sin** `--allow-fs-*` ni `--allow-child-process`. Verificado: leer, escribir y lanzar procesos dan `ERR_ACCESS_DENIED`.
2. El permission model de Node 22 **no bloquea la red**. Por eso un hook de carga de módulos (`module.register`) rechaza `node:net`, `http`, `https`, `tls`, `dgram`, `child_process`, `worker_threads`, `vm` e `inspector`, y se eliminan `fetch`, `WebSocket` y `EventSource` de `globalThis` antes de correr el código.
3. El código del modelo solo ve un objeto `silka` cuyas funciones viajan por IPC al bridge. El bridge aplica los mismos permisos que hoy: `allowedWorkspaces`, guarda de profundidad y lista blanca de herramientas.
4. Límites: tiempo por ejecución (por defecto 60 s; `waitAll` usa su propio tope y no bloquea el sandbox, porque el bridge espera y responde), `--max-old-space-size=128` y salida máxima de 8 KB. Si la salida pasa de 8 KB, **no se trunca**: se guarda y se devuelve una referencia `out:<id>` (P2).
5. Las firmas para `silka_search` salen de un `silka.d.ts` generado de la API real. Se busca por palabras y se devuelven solo los fragmentos que coinciden.

**Lo que no cubre.** Las herramientas internas de Codex, Cursor y OpenCode (sus Read, Edit y Bash) no pasan por Silka. Code Mode aplica a lo que el manager hace con Silka y a lo que los sub-agentes piden a Silka por el bridge.

### 3.2 Bandeja de revisión

- Cada tarea terminada llega como **ficha**: qué cambió, archivos, decisiones, preguntas abiertas, resultado de las verificaciones, resumen del diff y riesgo (alto, medio o bajo, según tamaño del diff, archivos sensibles y verificaciones).
- En el TUI, `r` abre la bandeja, ordenada por riesgo. Las acciones son **aprobar** (pasa a la cola de mezcla), **rechazar con nota** (vuelve a la misma sesión, reanudando su conversación) y **descartar**.
- `enter` abre el detalle por referencia: diff, salida de tests o transcript, cargado solo si lo pides (P2).
- Las verificaciones salen de `verify` en el encargo (comandos del proyecto) y corren en el worktree de la tarea **antes** de que la ficha llegue a la bandeja (P4).

### 3.3 Cola de mezcla que re-verifica

- Cada tarea trabaja en su propio `git worktree` y su propia rama (`silka/<id>`).
- Al aprobar, la cola mezcla **de una en una**: hace rebase sobre la rama principal, vuelve a correr las verificaciones y hace la mezcla.
- Si algo falla (conflicto o tests), la tarea vuelve **a su agente** con el error exacto (P7) y queda "en reparación". Lo demás sigue avanzando.
- Los leases de `.silka/` (el estado compartido que ya existe) avisan antes de lanzar dos tareas que tocan los mismos archivos.

### 3.4 Contexto por referencia más medición

- **Paquete de repo**, construido una vez y reutilizado por todas las sesiones:
  - estructura del repo;
  - convenciones (de `AGENTS.md` / `CLAUDE.md`);
  - comandos de verificación;
  - bloque de estado.
  Va **al inicio y siempre en el mismo orden**, para aprovechar el caché de prompt de cada proveedor.
- Cada encargo recibe el paquete y punteros (archivos y símbolos relevantes según el `scope`), no copias de archivos (P6).
- **Medición por tarea:** tokens (de los eventos de uso de cada CLI: `turn.completed` de Codex, `step_finish` de OpenCode, resultado de Cursor), costo, tiempo, número de turnos, resultado de verificaciones y si se aprobó a la primera. Todo en `.silka/metrics.jsonl`.
- `silka.agents.stats()` y la vista `m` del TUI muestran la tabla por agente y modelo. Es la base del futuro marcador. En v1 solo se recolectan datos; no hay enrutamiento automático.

## 4. Fuera de v1 (a propósito, contra el efecto bola de nieve)

Sistemas de memoria (Mem0, Letta…), enrutadores de modelos, notificaciones al celular, catálogo de recetas, modelos locales, ACP como transporte, e integrar Serena, cxpak o RTK. Cada uno entra **solo** si v1 demuestra que falta y pasa el filtro: mantenimiento activo, licencia MIT o Apache, proceso separado y opcional, versión fijada, prueba de contrato y beneficio medido.

## 5. Criterios de aceptación (medidos en este repo)

1. **Encargar:** 5 tareas desde un archivo de plan, lanzadas en menos de 2 minutos con **una** llamada de Claude (`silka_execute`).
2. **Revisar:** cada ficha se decide en menos de 1 minuto sin abrir el transcript.
3. **Calidad:** menos de 1 de cada 5 entregas aprobadas rompe algo al mezclar (la cola lo detecta y lo devuelve).
4. **Tokens por diseño:** para el mismo lote, Claude gasta **al menos 70% menos** tokens de entrada con Code Mode que con las herramientas actuales.
5. **Calidad intacta:** la tasa de verificaciones que pasan **no baja** frente a la línea base (P8).
6. **Sandbox:** el código de `silka_execute` no puede leer ni escribir disco, lanzar procesos ni abrir red. Hay pruebas automáticas para cada caso.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| El sandbox tiene una fuga (red o un módulo no bloqueado) | Lista de denegación más pruebas que intentan cada vía. El bridge sigue aplicando permisos por su lado (defensa en profundidad). |
| El modelo escribe código que falla | El error vuelve completo y legible (P7) para que lo corrija. Las firmas tipadas de `silka_search` reducen errores. |
| Los worktrees duplican `node_modules` o bases de datos y puertos | Instalación por worktree solo si el plan lo pide; puerto por tarea configurable. Es un límite conocido del patrón y queda documentado. |
| Mezclar en cadena se vuelve lento | La cola es secuencial por seguridad. Lo que no comparte archivos (según los leases) puede verificarse en paralelo. |
| La medición de tokens depende de lo que reporta cada CLI | Se registra la fuente de cada número. Si una CLI no reporta, se marca "sin dato"; no se inventa. |

## 7. Orden de construcción

1. **Code Mode:** API `silka` tipada, `silka.d.ts`, sandbox, `silka_search` y `silka_execute`, con pruebas del sandbox.
2. **Worktrees y verificaciones por tarea:** lanzar aislado, correr `verify` y generar la ficha.
3. **Bandeja de revisión en el TUI y en la API.**
4. **Cola de mezcla con re-verificación y vuelta al agente.**
5. **Paquete de contexto y métricas;** medir los criterios 4 y 5 contra la línea base.

Cada fase se delega, se revisa y lleva un commit, como en las fases anteriores. Al final hay una ronda de E2E y QA contra la sección 5.
