Tarea OS: migrar las specs de Silka v1 al formato OpenSpec (solo documentación, nada de código).

OpenSpec ya está instalado (`npx openspec`, v2.1.1) y configurado en `openspec/config.yaml`: lee su `context` y sus `rules` antes de empezar. Para el formato exacto mira `npx openspec --help`, `npx openspec show --help` y las skills en `.claude/skills/openspec-*/SKILL.md`.

Fuentes a migrar (léelas completas):
- `docs/specs/features/F1-code-mode.md` … `F5-contexto-metricas.md`
- Lo implementado después y sin spec propia, a partir de los commits `feat(A)`, `feat(I)`, `fix(B7)`, el de reconexión con el hub y `perf(ui)` (usa `git log` y `git show --stat`) y de los briefs `docs/tasks/swarm/A-confiabilidad.md`, `I-integracion.md`, `B7-wait-mensaje.md`.

Destino: una spec por capacidad en `openspec/specs/<capacidad>/spec.md`: `code-mode`, `isolated-tasks`, `review-inbox`, `merge-queue`, `context-metrics`, `reliability`, `integration-waves`, `hub-connection`, `tui`. Cada una con Purpose y Requirements; cada Requirement con su ID original al inicio del título (FR-*, NFR-*, SEC-*) y al menos un Scenario WHEN/THEN que nombre la prueba que lo cubre (T-*, HL-*, TP-*, RR-*, I-WV-*…). Para lo que no tenga ID (ola A, integración, reconexión, TUI), crea IDs nuevos con prefijo FR-RL-, FR-IW-, FR-HC-, FR-UI- y dilo en tu respuesta. Lo pendiente (por ejemplo FR-RV-07 vista TUI, FR-MQ-02 reorden manual) se marca en el texto del requisito como pendiente, no se omite.

Luego:
1. Reemplaza el contenido de cada `docs/specs/features/F*.md` por una línea que apunte a su spec en `openspec/specs/` (no borres los archivos).
2. En `docs/architecture/traceability.md`, cambia la columna de spec de cada fila para que apunte a `openspec/specs/<capacidad>/spec.md`, sin tocar el resto.
3. `npx openspec validate --specs --strict` debe pasar sin errores.

Reglas: trabaja SOLO en este worktree (rama `swarm/os`), sin commits ni cambio de rama. No toques `src/`, `test/` ni `docs/adr/`. Termina con un mensaje de 8 líneas o menos: capacidades creadas, número de requisitos por capacidad, IDs nuevos inventados, resultado REAL de `openspec validate`.
