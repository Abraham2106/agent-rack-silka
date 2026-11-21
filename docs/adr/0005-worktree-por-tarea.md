# ADR-0005: Una tarea, una rama y un `git worktree`

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0006; [F2](../specs/features/F2-tareas-aisladas.md); [concurrency.md](../architecture/concurrency.md)

## Contexto
Varios agentes trabajando en el mismo árbol se pisan los archivos. La atribución de cambios se vuelve ambigua (ya visto en QA, E2E-3) y una verificación puede ver cambios a medias de otra tarea.

## Decisión
Cada tarea de v1 corre en su propio `git worktree`, en `.silka/worktrees/<id>`, sobre una rama `silka/<id>` creada desde el commit base. Al terminar se verifica dentro de su worktree. El worktree se elimina solo cuando la tarea se mezcla o se descarta, nunca mientras su sesión sigue viva.

## Alternativas
- **Mismo árbol con leases de archivos**: más ligero, pero no aísla los efectos de las verificaciones (artefactos de build, tests).
- **Contenedor por tarea** (container-use): aísla también puertos y bases de datos, pero es pesado y depende de Docker. Queda como opción futura detrás de la interfaz `TaskIsolation`.

## Consecuencias
- (+) Las verificaciones y la atribución son exactas por tarea.
- (+) Rechazar o descartar es borrar el worktree y la rama.
- (−) Los recursos compartidos (puertos, bases locales, `node_modules`) no quedan aislados. La spec F2 define instalación por worktree y un puerto por tarea configurable.
- (−) Hay más uso de disco. Se mitiga con limpieza al mezclar o descartar y un límite de worktrees vivos.
