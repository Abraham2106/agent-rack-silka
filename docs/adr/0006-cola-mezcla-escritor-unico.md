# ADR-0006: La cola de mezcla es un escritor único y secuencial que re-verifica

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0005; [F4](../specs/features/F4-cola-mezcla.md); [concurrency.md](../architecture/concurrency.md)

## Contexto
Varias tareas aprobadas casi al mismo tiempo pueden romperse entre sí al mezclarse, aunque cada una haya pasado sus verificaciones por separado (problema de *semantic merge*). Además, dos procesos que mezclan a la vez sobre la rama principal pueden corromper el estado.

## Decisión
- Un solo proceso, el hub, es dueño de la cola de mezcla (patrón *single writer*). Las aprobaciones solo **encolan**. La mezcla la hace el hub, una tarea a la vez:
  1. rebase sobre la rama principal;
  2. re-ejecutar `verify`;
  3. hacer la mezcla con fast-forward.
- Si falla, la tarea pasa a "en reparación" y vuelve a su sesión con el error íntegro.
- La propiedad de la cola se garantiza con un lock de dueño con *fencing token* (ver H1 en concurrency.md). Si hay dos hubs, solo el que tiene el token vigente puede mezclar.

## Alternativas
- **Mezclar en paralelo** lo que no comparte archivos: es más rápido, pero no detecta roturas semánticas. Se deja como optimización futura, solo para la fase de verificación especulativa.
- **Merge queue de GitHub**: requiere remoto y CI, y no está ligada a las sesiones de agentes.

## Consecuencias
- (+) Ninguna mezcla deja la rama principal sin verificar.
- (+) El fallo se atribuye a una tarea concreta.
- (−) El rendimiento queda limitado por la duración de `verify`. Se mide (F5) y, si es el cuello de botella, se evalúa la verificación especulativa.
