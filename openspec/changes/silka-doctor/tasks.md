# Tasks

## 1. Base

- [ ] 1.1 Módulo `src/silka/doctor/` con el formato de resultado (punto, estado, causa, arreglo) y verificar con una prueba que el formato es estable
- [ ] 1.2 Subcomando `silka doctor` y `--json` con código de salida y verificar con una prueba (DR-05)

## 2. Comprobaciones

- [ ] 2.1 Node, agent-rack y config efectiva con la carpeta de worktrees permitida; verificar con una config que no la cubre (DR-01)
- [ ] 2.2 Hubs y bridges vivos, y si un bridge arrancó antes del último commit; verificar con procesos simulados (DR-02, DR-03)
- [ ] 2.3 CLIs de agentes instalados y con sesión; verificar con un PATH de prueba
- [ ] 2.4 Worktrees huérfanos, enlaces de `node_modules`, registro de repos y tamaño de notas y logs; verificar con un directorio de prueba

## 3. Garantías

- [ ] 3.1 Prueba de que doctor no cambia archivos ni procesos (DR-04)
- [ ] 3.2 Documentar `silka doctor` en el README y en la ayuda de la CLI y verificar que el ejemplo corre
