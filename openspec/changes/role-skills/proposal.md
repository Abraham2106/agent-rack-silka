# Proposal

## Why

Las instrucciones de cómo trabajar un rol (qué cuidar al implementar, qué buscar al revisar, cómo verificar) hoy
viven en el prompt que escribe el manager cada vez. Se repiten, se olvidan y no se versionan. Silka ya sabe
anteponer memoria acotada al encargo (`memoryPrefix`); lo mismo sirve para skills por rol.

## What Changes

- Skills como archivos Markdown en `.silka/skills/<rol>/<nombre>.md` (roles: `implementador`, `revisor`,
  `verificador`), con cabecera que declara rol y alcance (rutas o áreas).
- Silka antepone al encargo solo las skills del rol de la tarea cuyo alcance coincide, con tope de tamaño y el
  resto por referencia, igual que la memoria.
- `silka skills ls` lista las skills disponibles con rol, alcance y tamaño.
- Una skill mal formada se ignora con aviso; nunca impide lanzar la tarea.

**Fuera de alcance:** descargar o instalar skills de catálogos externos; ejecutar código desde una skill;
skills por usuario fuera del repo; editar skills desde la TUI.

## Dependencias

Depende de `agent-memory` (archivado): reutiliza la selección por alcance, el tope y el formato de referencia de
`memoryPrefix` en `src/silka/memory.mjs`. Sin dependencia de `model-routing`, `silka-setup` ni `review-guardrails`
(este último puede usarla para el rol `revisor`, pero funciona sin ella).

## Capabilities

### New Capabilities

- `role-skills`: skills por rol versionadas en el repo e inyectadas de forma acotada en el encargo.

### Modified Capabilities

(ninguna)

## Impact

- Módulo nuevo `src/silka/skills.mjs`, ajuste en `src/silka/tasks/manager.mjs` (antepone skills junto a la
  memoria) y CLI `silka skills ls`.
- Aumenta algo el prompt; el tope lo acota.
