# Plan: implementar los pendientes de las specs con Silka

Fecha: 2026-11-21. Contexto: el primer intento (9 tareas a la vez, comparando Composer 2.5 y Hy4 flash) se
atascó por defectos de Silka misma bajo condiciones reales que las pruebas no cubrían: reinicio del equipo,
varios programas conectados a la vez y un lote grande. Detalle en
[`docs/bugs/2026-11-21-registro-y-supervisor.md`](../bugs/2026-11-21-registro-y-supervisor.md).

## Qué se puede garantizar y qué no

**Garantizado tras los arreglos:** el repo principal está protegido. Los worktrees viven fuera del repo,
Silka no trabaja en un worktree perdido y nada se mezcla sin aprobación en la bandeja. El peor caso ya no es
dañar código, sino perder tiempo y cuota con tareas que se atascan.

**No garantizado todavía:**
1. BUG-04, varios hubs a la vez: se arregla en el paso 1.
2. BUG-05, `ECONNRESET` al lanzar muchas tareas juntas: se esquiva con lotes chicos (paso 4).
3. Tope de sesiones simultáneas de agent-rack: se respeta con lotes chicos.
4. Los arreglos de hoy no habían corrido con agentes reales: lo prueba el piloto (paso 3).

## Pasos

1. **Arreglar BUG-04:** un solo hub por puerto, con candado de arranque y dueño registrado.
2. **Reiniciar el hub limpio** y comprobar en `<config>/hub.log` que hay uno solo.
3. **Piloto con 2 tareas chicas** de punta a punta: setup → agente → verify → ficha → bandeja. Si algo se
   rompe, rompe en pequeño.
4. **Lotes de 3 o 4 tareas como máximo**, nunca 9 de golpe, con los pendientes de las specs:

| Spec | Pendiente |
|---|---|
| `review-inbox` | FR-RV-07: vista de la bandeja en el TUI (`r`, `a`, `x`, `d`, enter) |
| `merge-queue` | FR-MQ-02: reorden manual por humano · FR-MQ-09: vista de la cola en el TUI |
| `code-mode` | FR-CM-01: `silka_search` con el cuerpo de las interfaces · FR-CM-04/08: documentar `isolate`, `setup`, `setupMode` |
| `context-metrics` | FR-ME-01/02: métricas registradas solas al cerrar tareas y mezclas |
| `hub-connection` | Pruebas de regresión del hub (entorno sin variables del arnés en todos los caminos) |

5. **Revisión:** leer las fichas y mirar a fondo solo lo de riesgo alto o lo que falle. Cada pieza aprobada pasa
   por la cola de mezcla y lleva su commit.

## Criterio para detenerse

Si el piloto encuentra un defecto de Silka (no del trabajo del agente), se corrige y se repite el piloto antes
de pasar a los lotes. No se lanza un lote mientras haya un defecto de la plataforma abierto.
