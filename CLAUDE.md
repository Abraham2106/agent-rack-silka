# Silka (agent-rack-silka)

Capa de orquestación sobre agent-rack: Claude (manager) delega trabajo de código a Codex, Cursor y OpenCode en
worktrees aislados; Silka verifica con comandos propios, genera fichas, revisa en una bandeja y mezcla por una
cola de un solo escritor. Plataforma principal: Windows. Responde en español.

## Dónde está cada cosa

- `src/silka/`: CLI (`cli.mjs`), hub y supervisores (`hub.mjs`, `tasks/supervisor.mjs`, `merge/`), tareas y
  worktrees (`tasks/`), Code Mode (`codemode/`, contrato en `codemode/silka.d.ts`), TUI (`ui.mjs`, `ui/`).
- Specs: `openspec/specs/` (fuente de verdad) y cambios propuestos en `openspec/changes/`. Por qué de cada
  decisión: `docs/adr/`. Bugs y lecciones: `docs/bugs/`. Planes: `docs/plan/`.
- Worktrees de tareas: fuera del repo, en `%LOCALAPPDATA%\silka\wt\<repo>-<hash>\<id>`.
- Config y logs de Silka: `~/.config/silka/` (`hub.log`, `task-repos.json`). Estado de tareas:
  `.silka/tasks-v1/tasks.json`.

## Comandos

- Pruebas: `npm test` (todas las de `test/*.test.mjs`, aisladas de la config real por `test/setup-env.mjs`).
- Prueba real del ciclo de tareas (agent-rack real, sesión de agente real): `npm run e2e:worktree`.
- Specs: `npm run spec:validate` (OpenSpec, modo estricto).
- Hub: `node src/silka/cli.mjs hub` · TUI: `node src/silka/cli.mjs ui` · sesiones: `node src/silka/cli.mjs ls`.

## Reglas

- **No decir "comprobado"** en cambios al ciclo de tareas (worktrees, setup, supervisor, hub, config de
  agent-rack) sin correr `npm run e2e:worktree`. Las pruebas usan hubs falsos y no cubren reinicios, tiempos
  reales, `allowedWorkspaces` ni el tope de 5 sesiones. Si no se corrió la prueba real, decirlo.
- **No usar Silka para desarrollar Silka** mientras no haya una versión estable etiquetada: los arreglos de la
  plataforma se hacen directo.
- **Windows:** antes de borrar un worktree, soltar el junction de `node_modules` desde PowerShell
  (`cmd /c rmdir`, sin `/s`) y comprobar que el `node_modules` del repo sigue intacto. En heredocs de bash `\\`
  se convierte en `\`: escribir JS con barras invertidas con la herramienta de edición, no con heredocs.
- **Un solo hub.** Antes de lanzar tareas, comprobar que hay un hub y que no corre código viejo; el bridge MCP de
  una sesión vieja también puede llevar código anterior a los últimos cambios.
- **Salidas cortas:** no volcar logs, listas ni notas completas al contexto; resumir con scripts (conteos,
  últimas líneas, primeros N).
- **Commits:** uno por pieza, mensajes en español con el porqué, nunca `--no-verify`. **Push solo cuando el
  usuario lo pida.** Repo público: revisar que no se suban rutas ni datos personales.
- No tocar la config de agent-rack del usuario: el hub genera una config efectiva aparte.
