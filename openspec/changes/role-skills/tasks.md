# Tasks

## 1. Lectura

- [x] 1.1 Módulo `src/silka/skills.mjs` que lee y valida skills con cabecera de rol y alcance, y verificar con `node --test test/skills.test.mjs` (RS-01, RS-05)
- [x] 1.2 `silka skills ls` y `--json`, y verificar con una prueba de salida (RS-04)

## 2. Inyección

- [x] 2.1 Selección por rol y alcance con tope de 3 KB, reutilizando la selección de `src/silka/memory.mjs`, y verificar con pruebas (RS-02, RS-03)
- [x] 2.2 Anteponer skills junto a `memoryPrefix` en `startPendingSessions`, y verificar con una prueba con hub falso que el payload las contiene

## 3. Contenido inicial

- [x] 3.1 Escribir una skill corta por rol en `.silka/skills/` (por ejemplo, soltar el junction de `node_modules` antes de borrar un worktree), y verificar con `silka skills ls`
- [ ] 3.2 Ejecutar `npm test` y `npm run spec:validate`, y verificar que pasan

Verificación real: toca el encargo; correr `npm run e2e:worktree` antes de decir "comprobado".
