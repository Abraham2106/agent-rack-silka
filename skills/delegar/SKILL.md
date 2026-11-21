---
name: delegar
description: Delegar trabajo de código a Codex, OpenCode o Cursor a través del MCP agent-rack (herramientas codex_run, opencode_run, cursor_run, agent_session_create, agent_review). Úsalo cuando una tarea de implementación es clara y acotada, cuando conviene paralelizar, cuando quieres ahorrar contexto/tokens, o cuando el usuario pide que otro agente haga el trabajo.
---

# Delegar a otros agentes (agent-rack)

Tú eres quien decide y revisa. Los otros agentes ejecutan. Delegar cuesta solo un tool call
y te devuelve la respuesta final del agente, sin el transcript.

El MCP `agent-rack` es el puente de silka (`silka bridge`): la sesión queda en el hub y se ve en
`silka ui` con tu origen. Si una herramienta responde que `SILKA_DEPTH` llegó al máximo, no
insistas: ese agente ya está anidado y no puede lanzar otro.

## Cuándo delegar
- Tareas de implementación claras: un endpoint, un componente, un refactor, tests, un fix con causa conocida.
- Trabajo paralelo e independiente: lanza varias sesiones a la vez (máximo 5).
- Tareas mecánicas o largas que llenarían tu contexto.

No delegues lo que requiere decisiones de diseño abiertas ni lo que resuelves en 1 o 2 ediciones.

## Qué agente
| Agente | Úsalo para |
|---|---|
| `codex` | Implementación seria y refactors. Tiene sandbox real. |
| `cursor` | UI/frontend y cambios en varios archivos. |
| `opencode` | Tareas baratas o simples (modelo gratis por defecto). Con `model` usa otro proveedor. |

## El prompt: corto, con 4 cosas
```
Tarea: <qué hacer, 1-2 líneas>
Alcance: <qué archivos/carpetas sí, qué NO tocar>
Entrega: <qué debe existir al final>
Prueba: <comando para verificar, p. ej. npm test -- users>
Al terminar responde en ≤5 líneas: qué cambiaste, archivos tocados y resultado de la prueba.
```
No le expliques el código entero: el agente lo puede leer. Siempre pasa `workspace` con la ruta
absoluta del repo.

## Cómo llamarlo
- Tarea corta (menos de ~5 min): `codex_run` / `cursor_run` / `opencode_run`, que esperan a que termine.
- Tarea larga o en paralelo: `agent_session_create` te da un `sessionId` y sigues con lo tuyo.
  Después usa `agent_session_status`. Usa `agent_session_logs` con `tail` pequeño **solo si algo salió mal**.
- Seguimiento sobre el mismo trabajo: `agent_session_send` (retoma la misma conversación).
- No hagas polling seguido. Revisa cuando termines tu propio trabajo.

## Estado del proyecto
El shim ya antepone un bloque corto al prompt. Si necesitas el mismo dato, o quieres dejar una decisión:

- `silka_state({workspace})` — rama, HEAD, cambios de otros agentes, tareas en curso y las últimas decisiones.
- `silka_changes({workspace, since?})` — qué cambió desde una fecha ISO. Sin `since`, las últimas 2 horas.
- `silka_decide({workspace, text})` — anota una decisión (autor, fecha, sesión y texto).
- `silka_decisions({workspace, limit})` — las últimas decisiones.

`workspace` es la ruta absoluta del repo. No pegues archivos enteros: el bloque ya es corto.

## Corregir a un agente (`silka_send`)
Úsalo para corregir algo que mandaste mal, o cuando el usuario te lo pida
("lo que le mandaste a codex está mal, corrígelo").

- `silka_send({sessionId, text})` encola. Es lo normal: el agente lo recibe al terminar el turno.
- `silka_send({sessionId, text, now:true})` interrumpe y retoma la misma conversación. Úsalo solo si el agente va por mal camino. Si no, encola. Reanudar carga el contexto otra vez y gasta tokens.
- El autor queda como `claude`.
- Si `silka_notes` o `silka_state` traen una inserción del usuario (`tú → agente`), respétala. No la contradigas sin preguntarle.

## Verificar (ligero)
Al revisar una sesión, llama `silka_notes`.
Elige una:
1. Mira `git diff --stat` y corre tú el comando de prueba.
2. Pídele a otro agente `agent_review` (solo lectura, devuelve `verdict` y `findings`).
3. Pídele al mismo agente con `agent_session_send` que corra las pruebas y confirme.

Reporta al usuario en pocas líneas qué agente hizo qué y si pasó la prueba.
