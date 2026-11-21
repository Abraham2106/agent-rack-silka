# Plan: versión estable de Silka (v1.0.0-beta)

Fecha: 2026-11-21. Estado de partida: `silka-roadmap` (= `main` local, `3ec3afe`, sin push) integra 8 tareas
hechas con Silka; suite 173/173. Quedó fuera `mq-reorden-vista-2` (reorden manual de la cola: falla sus pruebas y
tocó `cli.mjs` y `state.mjs` fuera de alcance; su worktree sigue intacto). Bugs conocidos en
[`docs/bugs/2026-11-21-registro-y-supervisor.md`](../bugs/2026-11-21-registro-y-supervisor.md).

Regla: los arreglos de la plataforma se hacen directo, no delegando con Silka (no se opera al paciente consigo
mismo). Ningún cambio al ciclo de tareas se da por comprobado sin `npm run e2e:worktree`.

## Fase 1 · Estabilizar

1. **BUG-09:** la ficha da "pass" con la sesión caída o sin cambios. El supervisor guarda cómo terminó la sesión
   (`completed`, `failed`, `cancelled`, `desaparecida`); la ficha agrega evidencia `session` y `diff` (sin cambios
   → falla, salvo `allowEmptyDiff`); si falla alguna, no se corre verify. `card.mjs`: allOk = todos los ítems ok.
2. **BUG-11:** el verify corre síncrono dentro del hub (~3 min), lo congela y se cae su conexión. Correr setup y
   verify en un proceso aparte; el supervisor lo lanza y recoge el resultado; el vigilante de 2 min no debe
   confundir un verify largo con un cuelgue.
3. **BUG-04:** varios hubs a la vez. Dueño registrado del hub (pid + hora de inicio, contra reuso de pid) y
   candado de arranque en `ensureHub`; un hub que ve otro vivo no arranca supervisores.
4. **El hub se cierra solo** al correr `node src/silka/cli.mjs hub` en una terminal (agent-rack directo sí se
   queda vivo). Reproducir y corregir.
5. **BUG-10:** ante "Maximum concurrent sessions", esperar 30 s antes de reintentar y loguear una vez.
6. **IDs de tarea:** reusar el id de una tarea descartada da `E_CONFLICT` críptico; mensaje claro o `--reemplazar`.
7. **BUG-05:** reproducir `ECONNRESET` al lanzar en lote con un solo hub.

## Fase 2 · Probar MCP Agent Mail (prueba con salida)

Reemplazaría `silka_notes` (archivo único de 139 KB, 593 notas, ~95% avisos de conflicto repetidos).
Datos verificados: la versión Python está obsoleta, reemplazada por `mcp_agent_mail_rust`; HTTP (puerto 8765) o
stdio; identidades por proyecto; `send_message`, `fetch_inbox`, `mark_message_read`, `search_messages`,
`file_reservation_paths` (reservas con TTL y exclusivas), `release_file_reservations`; SQLite + repo git.
No consta: soporte de Windows, borrar mensajes o vaciar bandejas, licencia.

8. Instalar la versión Rust en Windows, en una carpeta aparte.
9. Probar: dos agentes, enviar y leer, reserva exclusiva que choca con otra.
10. Responder: Windows, borrado (notas volátiles por sesión), licencia, consumo.
11. Decidir. Si no pasa: diseño propio, un archivo de notas por sesión
    (`<config>/notes/<sesión>.jsonl`), volátil al cerrarse la tarea y leerse (24 h si la sesión desaparece),
    `silka_notes` sin sesión devuelve solo conteos, y los conflictos pasan a ser estado de la tarea.

## Fase 3 · Integrar Agent Mail (si la fase 2 pasa)

12. El hub levanta o detecta Agent Mail y registra el proyecto de cada repo.
13. Identidades: el manager y cada tarea (por su id).
14. `silka_notes` → bandeja del manager en Agent Mail, con lectura paginada.
15. Reservas: al lanzar un plan se reserva en exclusivo el `scope` de cada tarea; choque → aviso antes de lanzar;
    se liberan al mezclar o descartar.
16. Volatilidad: borrar o archivar el hilo de la sesión al cerrarse su tarea y leerse.
17. Migración: descartar el archivo de notas actual.

## Fase 4 · Cerrar

18. Prueba real del camino completo (agent-rack y Agent Mail reales): lanzar, reservar, trabajar, verificar,
    ficha, aprobar, mezclar, liberar.
19. PR `silka-roadmap` → `main` (en borrador hasta aquí).
20. Tag `v1.0.0-beta`: la versión que se usa para delegar; el desarrollo sigue en otra rama.

## Happy path esperado

Spec (OpenSpec) → Claude arma el plan (alcance, entregable, verify y modelo por tarea) y lo lanza con una
llamada a `silka_execute` → Silka crea worktrees fuera del repo, prepara dependencias y arranca hasta 4 agentes →
al terminar cada uno, verify en proceso aparte y ficha honesta; si falla, reparación con el mismo agente →
revisión en la bandeja (`silka ui`, tecla `r`), lo de riesgo alto lo aprueba el humano → cola de mezcla con
pruebas y búsqueda del culpable por oleada → rama con un commit por tarea, lista para PR.
