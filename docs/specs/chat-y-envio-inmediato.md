# Funcionalidad: chat con agentes y envío inmediato (Ctrl+Enter)

Estado: propuesta, pendiente de aprobación.

## 1. Qué resuelve

Hoy, cuando Claude (o tú) lanza varios sub-agentes, puedes verlos en el TUI, pero hablarles es torpe:
- `send` solo encola, y el mensaje llega cuando el agente termina el turno completo, que pueden ser 20 minutos;
- `steer` corrige más rápido, pero abre una sesión nueva y el agente pierde todo su contexto;
- no hay una vista de conversación: ves pasos sueltos, no el diálogo.

Objetivo: **hablarle a cualquier agente mientras trabaja, como en Claude Code**. Lo que escribes queda en cola por defecto, y con Ctrl+Enter se manda ya. El agente sigue trabajando con tu instrucción sin perder lo que llevaba.

## 2. Experiencia

### 2.1 Vista de chat
Al seleccionar un agente en el TUI, el panel derecho pasa a ser una conversación:

```
┌ codex · gpt-6.1-sol · por claude · 4m12s ─────────────────────────────┐
│ claude  Implementa paginación en /users con tests                     │
│ codex   Voy a revisar el endpoint y los tests actuales.               │
│   → read src/api/users.ts                                             │
│   ✓ edit src/api/users.ts  (+42 −3)                                   │
│   $ npm test -- users      12 passed                                  │
│ tú      usa cursor-based, no offset                    ⚡ enviado ya   │
│ codex   Entendido, cambio a cursor-based.                             │
│   ◌ editando src/api/users.ts…                                        │
│ ── en cola ──────────────────────────────────────────────────────     │
│ tú      agrega también un test para page vacía              ⏳         │
├───────────────────────────────────────────────────────────────────────┤
│ › escribe a codex…   enter: en cola · ctrl+enter: enviar ya · ↑ editar │
└───────────────────────────────────────────────────────────────────────┘
```

- **Autor de cada mensaje:** claude, tú u otro agente.
- **Herramientas:** cada una ocupa 1 línea. Enter sobre la línea la expande y muestra el diff o la salida.
- **Estado del agente, siempre visible:** pensando, usando una herramienta, esperando turno o terminado.
- **Mensajes pendientes:** se ven al final, bajo "en cola".
- **Atajos:** Ctrl+B oculta la lista de agentes (chat a pantalla completa) y `/` busca en el chat.

### 2.2 Teclas
| Acción | Agente trabajando | Agente quieto |
|---|---|---|
| Enter | Encola (⏳) | Envía como turno nuevo |
| Ctrl+Enter (alterno: Alt+Enter o Ctrl+S) | **Envía ya**: interrumpe el paso actual y retoma la misma conversación con tu mensaje | Igual que Enter |
| ↑ con la caja vacía | Recupera el último mensaje en cola para editarlo | Historial de lo que escribiste |
| Ctrl+Enter sobre un mensaje en cola (seleccionado con ↑) | Lo saca de la cola y lo envía ya | — |
| Esc sobre un mensaje en cola | Lo elimina de la cola | — |
| Ctrl+N | Nota para el manager (Claude), sin tocar al agente | Igual |

### 2.3 Reglas de entrega
- Si hay varios mensajes en cola al terminar el turno, se entregan juntos en un solo mensaje, en orden y con su autor.
- "Enviar ya" entrega tu mensaje **más** todo lo que esté en cola, para no saltarse instrucciones previas.
- Lo que tú insertas tiene prioridad explícita en el texto: "Mensaje del usuario (tiene prioridad sobre instrucciones anteriores)".
- Claude se entera: cada inserción queda en el estado compartido y en `silka_notes` ("tú → codex 3f2a: usa cursor-based"). El skill `delegar` le indica que no la contradiga sin preguntarte.

### 2.4 Sesiones lanzadas por Claude
Funciona igual con las sesiones que Claude creó por el bridge. Tú le hablas directo al sub-agente, y Claude ve el cambio cuando revise.

## 3. Cómo funciona por dentro

### 3.1 Niveles de envío (Silka elige el mejor disponible por agente)
| Nivel | Mecanismo | Agentes | Estado |
|---|---|---|---|
| A. En vivo | El mensaje entra sin detener al agente; lo toma en su siguiente paso | OpenCode (`opencode serve` + API), Codex (`app-server`), Claude Code (`--input-format stream-json`) | **Por verificar**. Fase opcional |
| B. Interrumpir y retomar | Se detiene el paso actual y se reanuda **la misma conversación** con el mensaje | Codex (`exec resume`), Cursor (`--resume`), OpenCode (`-s`) | Base de esta funcionalidad |
| C. Cola | Se entrega al terminar el turno | Todos | Ya existe; se mueve al hub |

### 3.2 Componentes
1. **Historial de conversación**, en `~/.config/silka/transcripts/<sesión>.jsonl`.
   - Guarda los turnos (quién pidió qué), los mensajes del agente, las herramientas, las inserciones y las interrupciones.
   - Lo escribe el shim, que ve todo. Sobrevive a los reanudes (cada turno es un proceso nuevo) y a reinicios del TUI.
2. **Id de conversación por sesión.**
   - El shim ya recibe el thread de Codex, el chat de Cursor y la sesión de OpenCode, y los guarda en `.silka/tasks.json` y en el historial.
3. **Cola en el hub.**
   - Vive en `~/.config/silka/queue/<sesión>.json`, con escritura atómica y lock (ya existen).
   - Un **despachador** entrega la cola cuando el turno termina. Corre en el proceso de `silka hub`, así que hay que envolver agent-rack en lugar de solo lanzarlo, o en un proceso hermano.
   - Funciona con el TUI cerrado.
4. **Canal de interrupción al shim.**
   - El TUI o `silka send --now` escribe una orden en `~/.config/silka/interrupt/<pid-del-shim>`. El pid ya está en `.silka/tasks.json`.
   - El shim vigila esa orden. Al verla, detiene solo al agente y su árbol de procesos (ya existe: `taskkill /T` y rastreo de huérfanos) y termina el turno con el resumen "interrumpido por el usuario" y un código de salida normal.
   - No usa el cancel de agent-rack, porque agent-rack no permite reanudar una sesión cancelada.
   - Al cerrarse el turno, el despachador envía de inmediato el mensaje con `sendInput`, que reanuda la misma conversación.
5. **Vista de chat del TUI.**
   - Lee el historial y lo actualiza en vivo.
   - Agrega la caja de entrada con cola visible, edición con ↑ y Ctrl+Enter.
   - Hoy `ui.mjs` es grande. Conviene separarlo en `ui/` (lista, chat, entrada, estado).
6. **Detección de Ctrl+Enter.**
   - Activar el protocolo de teclado extendido (kitty o `modifyOtherKeys`) donde la terminal lo soporte.
   - Siempre ofrecer un atajo alterno (Alt+Enter o Ctrl+S) y mostrarlo en la ayuda.
7. **CLI.**
   - `silka send <id> "…"`: encola.
   - `silka send <id> "…" --now`: envía ya.
   - `silka queue <id>`: ver la cola. `--clear`: vaciarla.
   - Se elimina `steer`, que queda como alias de `send --now`.
8. **MCP para Claude.**
   - `silka_send({sessionId, text, now})`, para que Claude también pueda corregir a un sub-agente sin esperar.
   - `silka_notes` incluye las inserciones del usuario.

## 4. Qué hay que hacer (orden sugerido)

| # | Trabajo | Tamaño |
|---|---|---|
| 1 | Historial de conversación en el shim (formato y escritura) y captura del id de conversación | M |
| 2 | Vista de chat en el TUI, solo lectura (con el refactor de `ui.mjs` en módulos) | L |
| 3 | Cola en el hub con despachador; `silka send` / `silka queue` | M |
| 4 | Canal de interrupción en el shim con "enviar ya" (nivel B) en los tres agentes | M |
| 5 | Caja de entrada: cola visible, ↑ para editar, Ctrl+Enter con atajo alterno, Esc | M |
| 6 | `silka_send` y las inserciones visibles para Claude; actualizar el skill `delegar` | S |
| 7 | Tests (`node:test`) más una ronda de E2E y verificación como en la fase QA | M |


Son 7 tareas delegables, con la misma mecánica de antes: un agente por tarea, revisión y commit por tarea, y E2E al final.

## 5. Criterios de aceptación
- Con un agente trabajando, Enter deja el mensaje en cola. Se ve en el chat y llega al terminar el turno, aunque el TUI esté cerrado.
- Ctrl+Enter (o el atajo alterno) interrumpe en menos de 3 s, y el agente responde a tu mensaje **con contexto**: menciona lo que ya había hecho y no lo rehace.
- Funciona igual en Codex, Cursor y OpenCode, y en sesiones lanzadas por Claude.
- Varios mensajes en cola llegan juntos y en orden. Ningún mensaje se pierde ni se entrega dos veces.
- Claude ve tus inserciones en `silka_notes` / `silka_state`.
- El chat se reconstruye igual después de cerrar y abrir el TUI.

## 6. Riesgos

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| **Paso a medias al interrumpir**: un archivo escrito a la mitad, una instalación cortada o un test interrumpido | Alto | Media | El mensaje de reanudación dice que revise el estado antes de seguir. Se interrumpe solo entre herramientas cuando el stream lo permite (esperar al fin de la herramienta en curso, con un tope de unos 10 s). El estado compartido marca los archivos tocados en ese paso. |
| **Carreras**: interrumpir justo cuando el agente termina solo, o dos personas mandando a la vez (tú y Claude) | Medio | Media | Lock por sesión en la cola, entrega con id y una sola vez. Si el turno ya terminó, "enviar ya" pasa a ser un turno normal. |
| **Dependencia de agent-rack**: que reanude después de `completed`/`failed` y no después de `cancelled` es un comportamiento interno que puede cambiar al actualizar | Medio | Baja-media | Fijar la versión (ya está en 0.12.1) y un test E2E que lo cubra. Plan B: Silka reanuda directo con el id de conversación, sin pasar por `sendInput`. |
| **Reanudar falla en algún agente**: por ejemplo Cursor `--resume` con stream-json, o OpenCode `-s` con un servidor distinto | Medio | Media | Verificar cada agente antes de prometerlo. Si falla, se cae al nivel C (cola) y se avisa en el chat. |
| **Ctrl+Enter no se detecta** en la terminal del usuario (muchas mandan lo mismo que Enter) | Bajo | Alta | Atajo alterno siempre activo y visible. Probar en Windows Terminal, VS Code y iTerm. |
| **Costo en tokens**: cada interrupción reanuda la conversación y el agente vuelve a cargar su contexto, así que interrumpir seguido sale caro | Medio | Media | La cola por defecto agrupa mensajes. Mostrar en el chat cuántas interrupciones lleva la sesión. "Enviar ya" es la excepción, no la norma. |
| **Instrucciones contradictorias** entre tú y Claude, sin que Claude lo sepa | Medio | Media | Las inserciones quedan en el estado y en las notas con prioridad del usuario. El skill obliga a Claude a respetarlas o a preguntarte. |
| **El hub pasa a tener estado** (cola y despachador): si se cae, la cola espera | Bajo | Baja | La cola persiste en disco y el despachador la retoma al arrancar. |
| **Datos sensibles en el historial** (prompts, salidas de comandos) | Medio | Media | El historial vive en `~/.config/silka` (fuera del repo), redactado como los logs, con retención configurable y `silka clean`. |
| **El nivel A en vivo no existe o no es estable** en alguno de los harness | Bajo | Media | Es opcional. La funcionalidad completa se entrega con B y C. |
| **El TUI se vuelve complejo y lento** con historiales largos | Bajo | Media | Virtualizar el render (solo lo visible), cargar el historial por partes y separar `ui.mjs`. |

## 7. Decisiones (tomadas)
1. **Enter encola y Ctrl+Enter envía ya**, como en Claude Code.
2. **Alt+Enter es el atajo alterno** de Ctrl+Enter, siempre activo y visible en la ayuda.
3. **Claude también puede enviar y interrumpir** a los sub-agentes con `silka_send({now:true})`. Lo hace cuando detecta que mandó algo mal, o cuando el usuario se lo pide ("lo que le mandaste a codex está mal, corrígelo"). El skill `delegar` documenta cuándo hacerlo.
4. **El nivel A en vivo queda fuera.** Solo se usa lo que los harness soportan hoy en headless: interrumpir y retomar (B) y la cola (C). La tarea 8 se elimina.

## 8. Fuera de alcance
- Editar mensajes ya entregados.
- Ramificar conversaciones (probar dos instrucciones distintas desde el mismo punto).
- Chat con varios agentes a la vez (broadcast). Se puede agregar después sobre la misma cola.
