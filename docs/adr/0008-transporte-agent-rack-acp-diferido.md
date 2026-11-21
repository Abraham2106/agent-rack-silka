# ADR-0008: agent-rack sigue como transporte en v1; ACP queda diferido

- Estado: Aceptada
- Fecha: 2026-11-21

## Contexto
Hoy los agentes se manejan con agent-rack 0.12.1 más adaptadores propios (`agent-shim`). Son frágiles: parches para Windows, rutas que cambian con cada actualización, y no se puede reanudar una sesión cancelada. ACP (Agent Client Protocol, Apache 2.0) es un estándar adoptado por Claude Code, Codex y Gemini CLI, entre otros, que podría reemplazarlos.

## Decisión
v1 **no** cambia el transporte. Las funcionalidades F1–F5 se construyen sobre interfaces propias (`SessionPort`: crear, enviar, interrumpir, estado, eventos) que hoy implementa agent-rack más el shim. Migrar a ACP será un ADR futuro, cuando:
- los adaptadores actuales vuelvan a romperse, o
- se necesite algo que solo ACP da (sesiones vivas, permisos interactivos).

## Alternativas
- **Migrar a ACP ya**: reduce dependencias a largo plazo, pero es un cambio de base que retrasaría v1 sin mejorar la productividad del builder de inmediato.

## Consecuencias
- (+) v1 avanza sin reescribir el transporte.
- (+) La interfaz `SessionPort` hace que la migración futura sea un reemplazo y no una cirugía.
- (−) Se arrastra la deuda de los adaptadores, que queda registrada como riesgo R-07 en el ATAM.
