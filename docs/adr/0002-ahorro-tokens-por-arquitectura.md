# ADR-0002: El ahorro de tokens se obtiene por arquitectura, nunca recortando información

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0003, ADR-0010; [silka-v1 §2](../specs/silka-v1.md)

## Contexto
El valor de Silka depende de delegar mucho trabajo sin multiplicar el costo. Las técnicas comunes de ahorro (truncar contexto, resumir de forma irreversible, comprimir el prompt) bajan la calidad de forma silenciosa. El builder exige que el ahorro no afecte el resultado.

## Decisión
Silka ahorra tokens solo con mecanismos que **no destruyen señal**:
1. El modelo recibe resultados, no procesos. Lo determinista lo hace el código: esperar, sondear, verificar, mezclar.
2. Todo detalle queda accesible **por referencia** (`diff:`, `log:`, `transcript:`, `out:`). Nada se descarta.
3. Las interfaces son mínimas y se descubren bajo demanda (Code Mode, ADR-0003).
4. Lo estable va primero y siempre igual, para aprovechar el caché de prompt.
5. Solo se filtra ruido identificable (progreso, logs repetidos, tests que pasaron). Código, requisitos, errores y diffs nunca se comprimen.
6. Cada optimización se valida midiendo tokens **y** tasa de verificaciones. Si la calidad baja, se revierte.

## Alternativas descartadas
- Compresión con un modelo (por ejemplo LLMLingua) sobre prompts de tareas: puede borrar requisitos. Se permite solo sobre ruido, como opcional, y medido.
- Límites duros de tokens por tarea: cortan trabajo legítimo. Se usan **alertas**, no cortes.

## Consecuencias
- (+) El ahorro es auditable y reversible.
- (+) La calidad queda protegida por una métrica explícita (NFR-QUA-01).
- (−) Exige construir un almacén de referencias y la medición antes de poder afirmar ahorros.
