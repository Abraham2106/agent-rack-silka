# Tasks

## 1. Conjunto de tareas

- [ ] 1.1 Definir 3–5 tareas reales y acotadas en `scripts/benchmark/tasks.json` (alcance, entregable, verify) y verificar que cada una tenga verify ejecutable
- [ ] 1.2 Documentar en `docs/benchmarks/README.md` cómo se eligieron y cómo se corre, y verificar que el comando documentado arranca

## 2. Medición

- [ ] 2.1 Capturar el uso de tokens del manager que reporta el proveedor en los dos caminos y verificar con una prueba que una corrida sin dato queda como "sin dato" (TB-02)
- [ ] 2.2 Registrar calidad por tarea (verify a la primera, reparaciones, roturas al mezclar, fuera de alcance) desde `src/silka/metrics/` y verificar con una prueba que los dos caminos usan los mismos campos (TB-03)

## 3. Corrida e informe

- [ ] 3.1 Script `scripts/benchmark/run.mjs` que corre los dos caminos desde el mismo commit y verificar que lo registra en el informe (TB-01)
- [ ] 3.2 Generar el informe en `docs/benchmarks/<fecha>.md` con la tabla, la meta del 70% (cumple/no cumple) y los límites, y verificar con una prueba sobre datos fijos (TB-04, TB-05)
- [ ] 3.3 Correr el benchmark de verdad una vez y commitear el informe; verificar que el porcentaje sale de datos del proveedor
