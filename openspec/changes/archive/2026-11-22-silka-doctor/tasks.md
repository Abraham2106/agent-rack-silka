# Tasks

## 1. Base

- [x] 1.1 Módulo `src/silka/doctor/` con el formato de resultado (punto, estado, causa, arreglo) y verificar con una prueba que el formato es estable
- [x] 1.2 Subcomando `silka doctor` y `--json` con código de salida y verificar con una prueba (DR-05)

## 2. Comprobaciones

- [x] 2.1 Node, agent-rack y config efectiva con la carpeta de worktrees permitida; verificar con una config que no la cubre (DR-01)
- [x] 2.2 Hubs y bridges vivos, y si un bridge arrancó antes del último commit; verificar con procesos simulados (DR-02, DR-03)
- [x] 2.3 CLIs de agentes instalados y con sesión; verificar con un PATH de prueba
- [x] 2.4 Worktrees huérfanos, enlaces de `node_modules`, registro de repos y tamaño de notas y logs; verificar con un directorio de prueba

## 3. Garantías

- [x] 3.1 Prueba de que doctor no cambia archivos ni procesos (DR-04)
- [x] 3.2 Documentar `silka doctor` en el README y en la ayuda de la CLI y verificar que el ejemplo corre
