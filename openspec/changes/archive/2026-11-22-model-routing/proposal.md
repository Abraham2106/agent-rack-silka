# Proposal

## Why

Hoy cada tarea usa el modelo que ponga quien la encarga o el `defaultModel` global (`src/silka/tasks/manager.mjs`).
Planificar y revisar piden un modelo fuerte; implementar cambios chicos no. Sin una regla escrita, el costo y la
calidad dependen de que el manager se acuerde de elegir bien, y después nadie sabe qué modelo corrió cada tarea.

## What Changes

- Archivo versionado `.silka/routing.json` que asigna agente y modelo por rol (`planificar`, `implementar`,
  `revisar`) y por tamaño de tarea (`chica`, `media`, `grande`), con valores por defecto si no existe.
- Al lanzar la sesión, Silka resuelve agente y modelo así: lo que la tarea pida explícito, luego la tabla, luego
  el `defaultModel` actual. El ciclo de tareas no cambia.
- Cada ficha guarda el rol, el agente y el modelo que corrieron, y por qué regla se eligieron.
- Un modelo no disponible (según `models.mjs`) cae al siguiente de la tabla y lo deja anotado.

**Fuera de alcance:** elegir modelo según costo en dinero en tiempo real; reintentar con un modelo más fuerte si
la tarea falla; cambiar el catálogo de modelos de `models.mjs`; enrutar por contenido del prompt.

## Dependencias

Ninguna. Es la base opcional de `review-guardrails` (que la usa para elegir el modelo del revisor, pero funciona
sin ella).

## Capabilities

### New Capabilities

- `model-routing`: tabla versionada de agente y modelo por rol y tamaño, resolución en el encargo y registro en la
  ficha.

### Modified Capabilities

(ninguna)

## Impact

- `src/silka/tasks/manager.mjs` (resolución al crear la sesión), `src/silka/tasks/model.mjs` (campos de la tarea y
  la ficha), un módulo nuevo `src/silka/routing.mjs`, y la CLI (`silka routing show`).
- Sin cambios si no existe `.silka/routing.json`: se conserva el comportamiento actual.
