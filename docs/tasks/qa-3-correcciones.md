Rol: corrector. Arregla los hallazgos priorizados de E2E y QA, y deja tests automáticos.

Lee primero `docs/reports/e2e.md` y `docs/reports/qa.md` (tienen archivo:línea, reproducción y arreglo sugerido). Lista consolidada, en orden de prioridad:

1. [QA-1, alta] Cursor: quitar `--force`. Solo se usa con la política `danger-full-access`. Respeta `--permission-mode` (plan → `--mode plan`). Documenta en el README qué implica cada política para Cursor.
2. [QA-2, alta] Bridge: lista blanca de herramientas expuestas. `silka_*` y la creación de sesiones validan que el workspace esté dentro de `allowedWorkspaces` (rutas canónicas, sin `..`).
3. [QA-3, alta] El bloque "Estado del proyecto (silka)" SIEMPRE lo genera Silka. Si el prompt trae uno, se ignora o se escapa. Lo mismo con la marca `[silka depth= from=]`: solo la acepta el shim si viene del bridge (por ejemplo con un nonce o secreto por hub), nunca del texto del usuario.
4. [NUEVO, alta] Sesiones colgadas: el shim marca el fin cuando el proceso del agente termina, aunque queden procesos hijos con stdout abierto. Usa `exit` más un margen corto, y no esperes solo a `close`. Al terminar, mata el árbol de procesos del agente (`taskkill /T /F` en Windows). Caso real: una sesión de Cursor siguió "running" 20 minutos después de terminar.
5. [E2E-1, alta] `npm run setup` en un clon limpio falla porque importa `connect.mjs` → `hub.mjs` → `agent-rack` antes de instalar. Haz esos imports dinámicos después del `npm install`.
6. [QA-6, media] Escrituras concurrentes seguras en `~/.config/silka/*` y `.silka/*`: lock de archivo, o escritura atómica (tmp + rename) con reintento. `steer` no crea otra sesión si la anterior sigue viva tras cancelar.
7. [QA-4, media] Tope duro del texto que vuelve al manager, por ejemplo 2000 caracteres, con "…(recortado; ver silka logs)". Nunca pegues el stream.
8. [QA-5, media] Los logs crudos del shim van a `~/.config/silka/logs/`, rotados, no a `shims/logs/` dentro del repo. Redacta todo lo que parezca un token.
9. [QA-7, media] `taskkill /T` al apagar el hub y al matar el shim.
10. [E2E-2, media] Modelo inválido: mensaje claro (`modelo 'x' no existe para opencode`), no la palabra `error`. Lo mismo para cursor y codex si aplica.
11. [E2E-3, baja] Atribución de archivos: excluye los que ya cambiaban antes del turno. Si hay otras tareas activas en el mismo workspace, marca el cambio como "ambiguo" en vez de atribuirlo.
12. [QA-11.1, baja] TUI: las flechas no cambian de sesión mientras hay un borrador en la caja (o el borrador se guarda por sesión).
13. [baja] En el bloque de estado, una tarea sin archivos muestra la palabra "archivos". Que muestre "sin cambios".

Tests: agrega `npm test` con `node:test` (sin dependencias nuevas) que cubra:
- el parseo de args del shim y la marca de profundidad (incluida la inyección rechazada);
- el bloque de estado (longitud máxima, sin inyección);
- la atribución de archivos;
- la escritura concurrente de notas;
- la validación de workspaces del bridge;
- `format.pad` y `originLabel`.
Que corran en menos de 30 s y sin red ni modelos.

Reglas:
- El hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues ni lo reinicies. Si cambias código del hub, se aplica en el próximo arranque, y está bien.
- No toques configs externas (`~/.codex`, `~/.cursor`, `~/.config/opencode`, Claude).
- Cambios mínimos y legibles. No reescribas módulos enteros si no hace falta.

Prueba: `npm test`, `node --check` en todo, `npm run smoke`, y reproduce E2E-1 (clon limpio + setup) y E2E-2.

Al terminar responde en 10 líneas o menos: qué ítems quedaron (por número), cuáles no y por qué, y el resultado de `npm test` y smoke.
