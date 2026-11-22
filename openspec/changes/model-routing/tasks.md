# Tasks

## 1. Tabla

- [ ] 1.1 Módulo `src/silka/routing.mjs` que carga y valida `.silka/routing.json` con valores por defecto, y verificar con `node --test test/routing.test.mjs` (MR-01, MR-02)
- [ ] 1.2 `silka routing show` que imprime la tabla efectiva, y verificar con una prueba de la salida

## 2. Resolución

- [ ] 2.1 Resolver agente y modelo en `startPendingSessions` (explícito, tabla, defecto), y verificar con una prueba con hub falso que revisa el payload de `agent_session_create` (MR-03, MR-04)
- [ ] 2.2 Caída al siguiente modelo si `models.mjs` marca uno no disponible, y verificar con una prueba (MR-06)

## 3. Registro

- [ ] 3.1 Guardar rol, agente, modelo y regla en la tarea y mostrarlos en la ficha, y verificar con una prueba de ficha (MR-05)
- [ ] 3.2 Comprobar que sin `routing.json` el ciclo no cambia, y verificar con `npm test` completo y `npm run spec:validate`

Verificación real: este cambio toca el ciclo de tareas; no decir "comprobado" sin correr `npm run e2e:worktree`.
