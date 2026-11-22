# ADR-0010: Medir tokens y calidad juntos, por tarea, con fuente declarada

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0002; [F5](../specs/features/F5-contexto-metricas.md)

## Contexto
Sin medición, cualquier afirmación de ahorro es una opinión. Además, cada CLI reporta el uso de forma distinta: Codex en `turn.completed`, OpenCode en `step_finish` y Cursor en su resultado. Algunas no reportan nada.

## Decisión
- Por cada tarea se registra un evento en `.silka/metrics.jsonl` con:
  - agente, modelo, tokens de entrada y salida;
  - tokens de caché si existen;
  - turnos, tiempo, resultado de verificaciones;
  - si se aprobó a la primera;
  - la **fuente** de cada número.
- Si una CLI no reporta un dato, se registra como `null` con la fuente `"sin dato"`. **Nunca se estima en silencio.**
- Toda optimización (ADR-0002) se acepta solo si, sobre el mismo conjunto de tareas (PRs reales repetidos), baja los tokens **sin** bajar la tasa de verificaciones aprobadas.

## Consecuencias
- (+) El marcador futuro (qué agente y modelo rinde mejor) se apoya en datos reales.
- (−) Medir agrega un poco de E/S por tarea; es despreciable frente a la duración de una tarea.
