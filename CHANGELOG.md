# Cambios

Formato: lo más reciente primero. El porqué de cada decisión está en `docs/adr/` y los requisitos en
`openspec/specs/`.

## Versión de entrega (2026-11-22)

Estabilización de la plataforma y cierre de huecos frente a herramientas parecidas (gentle-ai, Conductor).

### Diagnóstico y entorno
- `silka doctor`: diagnóstico de solo lectura del entorno (hubs, bridges con código viejo, CLIs, worktrees
  huérfanos, carpeta de worktrees permitida). Con `--json` para el manager.
- `silka setup`: detecta los agentes instalados y prepara la config efectiva de Silka. Vista previa por defecto;
  `--apply` escribe solo en la carpeta de Silka y nunca en la config global del usuario.

### Contexto de los agentes
- Memoria de decisiones, aprendizajes y preferencias, inyectada por alcance con tope de 2 KB.
- Skills por rol (implementador, revisor, verificador) en `.silka/skills/`, inyectadas con tope de tamaño.
- Notas por sesión, paginadas y volátiles; los conflictos pasan a ser estado de la tarea y no notas repetidas.

### Modelos y revisión
- Enrutado de modelos por rol y tamaño de tarea (`.silka/routing.json`, `silka routing show`) con registro del
  modelo que corrió cada tarea. Sin el archivo el ciclo no cambia.
- Revisión automática acotada (desactivada por defecto): revisor independiente, solo lectura; un hallazgo grave
  sube el riesgo de la ficha a alto y la aprobación espera a la revisión.

### Seguridad
- Los agentes lanzados por Silka no crean otros agentes (límite de profundidad en el bridge), no ven otras tareas
  y no reciben `.env`, llaves ni `~/.ssh`. Cada intento bloqueado se audita y avisa al manager.
- `.env` solo se copia al worktree si el repo lo declara de forma explícita; `.env.production` y las llaves
  nunca se copian.

### Workspace
- Receta `silka.json` versionada: `setup`, `run`, `archive`, `copy`, `ports`, `runMode`, `shell`. Rango de puertos
  por tarea y variables `SILKA_*`. `silka workspace run|stop|ls|archive` cierra el árbol de procesos en Windows
  antes de borrar el worktree.

### Calidad y medición
- `evals/`: suite de calidad con piso de precisión que bloquea el merge, graders por código y por rúbrica, y envío
  por Batch API (`docs/evals.md`). Corre sin red con un modelo falso.
- Benchmark de tokens del manager con uso real del proveedor (`docs/benchmarks/`). La primera medición con un
  modelo gratuito no cumple la meta del 70% y su calidad no es válida; se corrigió el runner, pero la repetición
  no terminó.
- Pruebas sensibles a la carga ahora deterministas (puertos efímeros, relojes simulados, esperas con cota).

### Pendiente conocido
- Repetir el benchmark con el runner corregido y archivar el cambio `token-benchmark`.
- El cambio `bridge-code-mode-only` sigue sin implementar (0 de 7 tareas).
- El modo solo lectura del revisor se pasa al hub, pero no está verificado que cada agente lo aplique; la
  garantía real es la comprobación de que el worktree quedó igual.
- Cursor no se puede comprobar desde Silka (no carga el MCP en modo headless en la máquina de desarrollo).
- Un agente con shell todavía podría invocar la CLI `agent-rack` directamente.
