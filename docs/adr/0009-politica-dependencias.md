# ADR-0009: Política de dependencias externas (anti "bola de nieve")

- Estado: Aceptada
- Fecha: 2026-11-21

## Contexto
Hay muchos proyectos open source útiles: Graphify, Serena, cxpak, RTK, MCP Agent Mail, Beads, container-use, Mem0… Integrarlos todos convertiría a Silka en un conjunto frágil de bugs ajenos, versiones desalineadas, licencias incompatibles e instalación pesada.

## Decisión
Una dependencia entra **solo** si cumple todas estas condiciones:
1. Resuelve algo del núcleo que sería caro construir, o es un **estándar** (protocolo), no una librería.
2. Tiene mantenimiento activo: commits en los últimos 3 meses y releases.
3. Tiene licencia **MIT, Apache-2.0 o BSD**. Nada de AGPL o GPL ni licencias con cláusulas adicionales.
4. Se integra **fuera de proceso** (MCP o CLI), es **opcional** y Silka funciona igual sin ella.
5. Tiene versión fijada y una **prueba de contrato**.
6. Tiene un beneficio **medido** en nuestro repo (tokens o calidad), con un interruptor para apagarla.

Las dependencias en proceso (paquetes npm del núcleo) se limitan a las actuales: agent-rack, `@modelcontextprotocol/sdk`, ink y react. Agregar una más requiere un ADR.

## Consecuencias
- (+) El núcleo se mantiene pequeño, auditable e instalable con `npm install`.
- (−) Algunas capacidades llegan más tarde porque se construyen o se miden antes de adoptarse.
- Registro de evaluación: Graphify (opcional, ya integrado), basic-memory (rechazado: AGPL-3.0), Mem0/Letta (rechazados: no aportan al núcleo), RTK, Serena y cxpak (candidatos, pendientes de medir).
