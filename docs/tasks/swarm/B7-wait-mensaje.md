Tarea B7: `silka.wait` / `waitAll` de Code Mode devuelven `lastMessage` vacío después de un `silka.send` (sesión reanudada) y a veces también en el primer turno de Cursor, aunque el agente sí respondió.

Busca dónde se arma el resultado de wait/waitAll (src/silka/codemode/ y lo que use de agent-rack o del shim `shims/agent-shim.mjs`) y corrige para que devuelva el último mensaje de texto del agente **del turno más reciente** (no el de un turno anterior ni vacío), tomado de los eventos de la sesión. Si el turno terminó sin texto, devuelve `lastMessage: ''` con `noText: true` en vez de omitirlo. Agrega también `turn` (número de turno) al resultado. Actualiza silka.d.ts sin cambiar la versión mayor.

Toca solo lo necesario para wait/waitAll y el armado de su resultado. Pruebas en `test/codemode.test.mjs` con un hub falso: primer turno, turno reanudado tras send, turno sin texto, y eventos de stream-json de Cursor fragmentados en varios deltas.

Reglas: trabaja SOLO en este worktree (rama `swarm/b7`), sin commits ni cambio de rama. Ejecuta `npm test` y `node --check`; si la terminal falla, dilo. No toques el hub del puerto 8987. Termina con un mensaje final de 5 líneas o menos con el resultado REAL.
