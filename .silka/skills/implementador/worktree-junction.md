---
rol: implementador
alcance: src/silka/tasks/
---
# Worktrees y node_modules en Windows

- Antes de borrar un worktree, soltar primero el junction de `node_modules` desde PowerShell con
  `cmd /c rmdir node_modules` (sin `/s`). Nunca con `/s`: podría borrar el `node_modules` del repo.
- Después, comprobar que el `node_modules` del repo principal sigue intacto.
- Para crear el junction usar `cmd /c mklink /J node_modules "<ruta al node_modules del repo>"` desde PowerShell.
