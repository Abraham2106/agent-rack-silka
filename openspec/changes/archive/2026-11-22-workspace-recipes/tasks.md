# Tasks

## 1. Receta

- [x] 1.1 Leer y validar `silka.json` (setup, run, archive, copy, ports, runMode, shell, variantes por sistema) y verificar con pruebas de esquema (WR-01)
- [x] 1.2 Ejecutar los comandos con el shell declarado y variables expandidas igual en pwsh, cmd y bash, y verificar con pruebas en Windows

## 2. Copia y puertos

- [x] 2.1 Copiar `copy` y `.worktreeinclude` respetando la lista de denegación de `agent-containment`, y verificar con una prueba (WR-02)
- [x] 2.2 Rango contiguo de puertos libres bajo lock y variables `SILKA_*`, y verificar con dos tareas simultáneas (WR-03)

## 3. Ciclo del workspace

- [x] 3.1 `run`, `stop` y `archive` con cierre del árbol de procesos antes de borrar, y verificar en Windows con un servidor vivo (WR-04); correr también `npm run e2e:worktree`
- [x] 3.2 `runMode: exclusive` y verificar con una prueba (WR-05)
- [x] 3.3 `silka.workspace.*` en Code Mode y en la CLI, documentado, y verificar que el ejemplo del README corre
