# ADR-0003: Code Mode, una API tipada con `silka_search` y `silka_execute` para el manager

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0002, ADR-0004; [F1](../specs/features/F1-code-mode.md)

## Contexto
El bridge expone unas 20 herramientas MCP. Cada turno del manager carga todas sus definiciones, y cada paso intermedio (lanzar, consultar estado, leer logs) pasa por su contexto. Cloudflare (Code Mode) y Anthropic (*code execution with MCP*) mostraron reducciones del 78–99% en tokens de entrada, sin perder tasa de éxito, al exponer las herramientas como una API de código.

## Decisión
El bridge añade dos herramientas:
- `silka_search(query)`: devuelve solo las firmas relevantes de una API TypeScript (`silka.d.ts`).
- `silka_execute(code)`: corre un programa corto contra esa API en un sandbox (ADR-0004) y devuelve solo su valor de retorno, o una referencia si es grande.

Las herramientas actuales se mantienen como compatibilidad para clientes sin Code Mode.

## Alternativas
- **Mantener solo herramientas MCP**: más simple, pero escala mal en tokens y en número de turnos.
- **Herramientas "compuestas" fijas** (por ejemplo `launch_and_wait_all`): ahorran algo, pero cada combinación nueva exige otra herramienta y la superficie crece.
- **Que el manager escriba scripts de shell**: sin tipos y con acceso a todo el sistema. Inaceptable por seguridad.

## Consecuencias
- (+) Una intención se resuelve en una sola ida y vuelta (encargar en lote, esperar, filtrar).
- (+) Las llamadas son más precisas: los modelos escriben TypeScript mejor de lo que emiten *tool calls*.
- (−) Hay que ejecutar código generado por el modelo, lo que exige un sandbox sólido (ADR-0004) y un modelo de amenazas propio ([security.md](../architecture/security.md)).
- (−) La API `silka` pasa a ser un contrato público: requiere versionado (semver de `silka.d.ts`).
