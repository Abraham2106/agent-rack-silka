Revisión de F2: las piezas están bien y probadas, pero falta conectar el flujo principal. Completa esto en el mismo worktree:

1. `launch` con `isolate: 'worktree'` debe, además de crear la tarea y su worktree, **arrancar la sesión del agente** en el hub con `workspace = worktreePath` (usando el agente y el modelo de la tarea). Guarda el `sessionId` en la tarea y pasa a "trabajando".
2. **Supervisor de tareas** que corre dentro de `silka hub`, igual que el despachador de la cola (ver `src/silka/dispatch.mjs` y cómo lo arranca `hub.mjs`). Cuando la sesión de una tarea "trabajando" termina:
   - corre `verify` en su worktree;
   - genera la ficha;
   - pasa a "lista para revisión" o "reparando".
   Debe ser idempotente: si el hub se reinicia, retoma sin verificar dos veces.
   Agrega también `silka task verify <id>` para dispararlo a mano.
3. **SEC-06, hueco de seguridad**: `emptyHooksDir` está dentro del repo (`.silka/empty-hooks`) y un agente puede escribir ahí un hook que el hub ejecutaría. Muévelo a `silkaConfigDir()` (fuera del repo) y, antes de cada uso, verifica que esté vacío y borra lo que haya.
4. **SEC-07**: agrega una prueba que demuestre que `verify` solo ejecuta los comandos declarados en la tarea, aunque la salida del agente sugiera otros.
5. NFR-DISK-01: avisa (no bloquea) si los worktrees vivos superan `maxConcurrentTasks` + tareas listas.

Prueba de punta a punta en `test/tasks.test.mjs`:
- `launch` con un hub falso que simula una sesión que escribe archivos en el worktree y termina;
- el supervisor detecta el fin, corre `verify` y deja la ficha con los archivos correctos.

Ejecuta `npm test` y responde en 8 líneas o menos con el resultado REAL.
