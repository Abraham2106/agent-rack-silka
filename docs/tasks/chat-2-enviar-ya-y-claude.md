Tarea: implementar la PARTE 2 de la funcionalidad "chat con agentes y envío inmediato" y corregir el render del TUI.

Especificación: `docs/specs/chat-y-envio-inmediato.md`. La parte 1 ya está hecha: historial, vista de chat, `src/silka/ui/` en módulos, y la cola en el hub con despachador. Lee el código actual antes de cambiarlo.

0. PRIMERO, render a pantalla completa como Claude Code (https://code.claude.com/docs/en/fullscreen) y Antigravity.
   - Hoy cada actualización del TUI deja un rastro de cuadros viejos en el scrollback de la terminal, en vez de redibujarse en su lugar. Arréglalo:
     - `render(<App/>, { alternateScreen: true })` (Ink 8 lo soporta), así se restaura la terminal al salir con `q` o Ctrl+C, aunque haya un error;
     - el alto del layout es exactamente `stdout.rows`, sin pasarse nunca, porque si se pasa Ink vuelve a ensuciar la pantalla;
     - redibujar al redimensionar (`resize`);
     - la caja de entrada fija abajo y el encabezado fijo arriba;
     - el chat hace scroll DENTRO de la app: PgUp/PgDn, rueda del mouse si Ink lo permite, Home/End, y auto-scroll al final salvo que el usuario haya subido;
     - sin parpadeo: no actualizar el estado más de unas 10 veces por segundo; agrupa los eventos del polling.
   - Con `SILKA_NO_FULLSCREEN=1`, el TUI vuelve al modo actual.
   - Prueba: abre el TUI con una sesión activa durante 30 s. Al salir, el scrollback de la terminal no debe tener cuadros repetidos.

1. "Enviar ya" (nivel B de la sección 3.1, componente 4 de la sección 3.2):
   - El TUI o `silka send <id> "…" --now` escribe una orden de interrupción en `~/.config/silka/interrupt/<pid-del-shim>`. El pid está en `.silka/tasks.json`.
   - El shim vigila esa orden y espera a que termine la herramienta en curso (como máximo unos 10 s, para no cortar un archivo a medias).
   - Luego detiene al agente y su árbol (ya existe `signalProcessTree` / `killTracked`) y termina el turno con el resumen "interrumpido por el usuario" y salida normal. NO uses el cancel de agent-rack, porque no deja reanudar.
   - En seguida, el despachador entrega el mensaje más todo lo encolado, con `sendInput`, a la MISMA conversación. El texto dice "Mensaje del usuario (tiene prioridad sobre instrucciones anteriores): … Revisa el estado de los archivos antes de seguir; continúa desde donde ibas sin rehacer lo que ya está bien."
   - Si el turno ya había terminado, se envía como un turno normal. Lock por sesión y una sola entrega.
   - `steer` queda como alias de `send --now`.
2. Teclas en la caja de entrada del chat:
   - Enter encola, como ya está.
   - **Ctrl+Enter envía ya**, y **Alt+Enter** es su alterno, siempre activo.
   - Para detectar Ctrl+Enter, activa el protocolo de teclado extendido (kitty `CSI > 1 u` o `modifyOtherKeys`) donde la terminal lo soporte, y restáuralo al salir. Prueba Windows Terminal.
   - Con ↑ se selecciona un mensaje en cola; Ctrl+Enter o Alt+Enter lo saca de la cola y lo envía ya; Esc lo borra.
   - La ayuda (`?`) y la línea de atajos muestran todo esto.
   - En el chat, los mensajes enviados ya llevan ⚡ y los encolados ⏳.
3. Claude como manager. Nueva herramienta del bridge `silka_send({sessionId, text, now})`:
   - `now:true` interrumpe igual que Ctrl+Enter, y el autor queda como "claude".
   - Las inserciones del usuario (tú → agente) aparecen en `silka_notes` y en `silka_state`.
   - Actualiza `skills/delegar/SKILL.md`: cuándo usar `silka_send` (para corregir algo que Claude mandó mal o cuando el usuario se lo pida), que use `now` solo si el agente va por mal camino (si no, que encole), y que respete y no contradiga las inserciones del usuario sin preguntar.
4. Muestra en el chat cuántas interrupciones lleva la sesión, porque reanudar cuesta tokens.

Reglas:
- El hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node. Para probar interrupciones, usa un hub de prueba en OTRO puerto (config temporal con `port` distinto) y apágalo al terminar.
- No toques configs externas. No dejes procesos vivos tuyos al terminar.
- Tests con `node:test`:
  - la orden de interrupción;
  - que el shim espere a que termine la herramienta, con su tope;
  - la entrega de cola y mensaje juntos;
  - que nada se entregue dos veces;
  - el alias `steer`;
  - `silka_send` con y sin `now`;
  - los permisos: que un sub-agente no pueda usar `silka_send` sobre sesiones ajenas;
  - el parseo de Ctrl+Enter y Alt+Enter.
  `npm test` debe pasar completo.

Prueba real (con el hub de prueba), en los TRES agentes (codex, cursor con `grok-4.7-medium-fast`, opencode): lanza una tarea larga, encola un mensaje y luego envía otro con "enviar ya". El agente debe responder a ambos con contexto, mencionando lo que ya había hecho y sin empezar de cero. Anota el tiempo desde que envías hasta que el agente reacciona. Después `npm run smoke` y `node --check`.

Al terminar responde en 12 líneas o menos: archivos, resultado por agente (reacción en segundos y si mantuvo el contexto), tests, qué no funcionó.
