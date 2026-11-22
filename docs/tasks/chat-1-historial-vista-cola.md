Tarea: implementar la PARTE 1 de la funcionalidad "chat con agentes y envío inmediato".

Especificación completa (léela entera antes de empezar): `docs/specs/chat-y-envio-inmediato.md`. Las decisiones de la sección 7 ya están tomadas.

Esta parte cubre las tareas 1, 2 y 3 de la sección 4:
1. Historial de conversación en el shim (`~/.config/silka/transcripts/<sesión>.jsonl`), redactado como los logs. También la captura y el guardado del id de conversación de cada agente: thread de Codex, chat de Cursor, sesión de OpenCode. Ve `.silka/tasks.json`.
   - El historial necesita el sessionId de agent-rack. Hoy el shim no lo conoce, así que resuelve la asociación turno ↔ sesión de forma robusta. Ya existe `matchTaskSession` en `state.mjs`. Explica en el código cómo se asocian.
2. Vista de chat en el TUI, solo lectura.
   - Al seleccionar un agente, el panel derecho muestra la conversación como en la sección 2.1:
     - autor por mensaje;
     - herramientas en 1 línea, expandibles con Enter;
     - el estado del agente;
     - la sección "en cola".
   - Ctrl+B oculta la lista y `/` busca. Auto-scroll salvo que el usuario suba.
   - Separa `src/silka/ui.mjs` en módulos dentro de `src/silka/ui/` (lista, chat, entrada, estado, ayuda) sin perder lo que ya funciona: `n`, `c` con confirmación, `m`, `e`, `?`, `q`. Renderiza solo lo visible.
3. Cola en el hub, en `~/.config/silka/queue/<sesión>.json` (usa `lock.mjs` y la escritura atómica que ya existen).
   - Agrega un despachador que, cuando el turno de una sesión termina, entregue todo lo encolado en UN mensaje, en orden y con su autor, con `sendInput` (reanuda la misma conversación).
   - El despachador corre junto al hub (`silka hub`) y funciona con el TUI cerrado.
   - Entrega una sola vez (id por mensaje). Si se cae, al arrancar retoma la cola de disco.
   - CLI: `silka send <id> "…"` encola y `silka queue <id> [--clear]` muestra o vacía la cola.
   - Hoy el TUI encola en memoria. Pásalo a esta cola.

NO hagas todavía "enviar ya", Ctrl+Enter, `silka_send` ni la interrupción. Eso es la parte 2. Pero deja preparada la caja de entrada: Enter encola, ↑ edita el último mensaje encolado y Esc lo elimina.

Reglas:
- El hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node. Si el despachador requiere cambiar cómo arranca el hub, aplícalo en el código; se usará en el próximo arranque. Pruébalo con un hub en OTRO puerto, con una config temporal copiada de `agent-rack.config.json` y `port` distinto, y apágalo al terminar.
- No toques configs externas.
- Al terminar, no dejes procesos vivos que hayas lanzado tú.
- Tests con `node:test`: historial (formato, redacción, reconstrucción), cola (orden, agrupación, entrega una sola vez, persistencia) y asociación turno ↔ sesión. `npm test` debe pasar completo.

Prueba: `npm test`, `node --check` en todo, `npm run smoke`, y una prueba manual con el hub de prueba:
- una sesión de opencode con dos mensajes encolados mientras corre, que deben llegar juntos al terminar el turno;
- el chat reconstruido después de cerrar y abrir el TUI.

Al terminar responde en 10 líneas o menos: archivos, qué probaste, qué funcionó y qué no, y qué quedó listo para la parte 2.
