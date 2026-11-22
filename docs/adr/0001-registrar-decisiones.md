# ADR-0001: Registrar las decisiones de arquitectura

- Estado: Aceptada
- Fecha: 2026-11-21

## Contexto
Silka creció por fases, con decisiones tomadas en conversación: el puente, la cola, el sandbox, los worktrees. Sin un registro, el "por qué" se pierde y las decisiones se reabren una y otra vez.

## Decisión
Cada decisión que afecte estructura, seguridad, concurrencia, dependencias o atributos de calidad se registra como ADR en `docs/adr/NNNN-titulo.md`. El formato es el de Michael Nygard: contexto, decisión, alternativas, consecuencias y estado. Los ADR son inmutables: si una decisión cambia, se escribe uno nuevo que *reemplaza* al anterior y se enlazan entre sí.

## Alternativas
- Documentar solo en el README: no queda historia ni alternativas.
- Wiki externa: queda separada del código y no se versiona con él.

## Consecuencias
- (+) La matriz de trazabilidad puede apuntar a decisiones concretas.
- (+) Un agente puede leer el ADR antes de tocar un área.
- (−) Escribirlos cuesta algo de tiempo. Se mitiga con plantillas cortas.
