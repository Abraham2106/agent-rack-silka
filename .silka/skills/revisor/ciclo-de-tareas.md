---
rol: revisor
alcance: src/silka/
---
# Revisar cambios al ciclo de tareas

- Un cambio a worktrees, setup, supervisor, hub o config de agent-rack no se da por comprobado con pruebas
  unitarias: las pruebas usan hubs falsos. Pedir o comprobar `npm run e2e:worktree`.
- Si no se corrió la prueba real, el informe debe decirlo.
- Revisar que el hub siga siendo uno solo y que no se toque `~/.config/silka` desde pruebas.
