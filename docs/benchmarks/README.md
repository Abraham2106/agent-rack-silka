# Benchmark de tokens del manager

Mide cuánto se ahorra en tokens de entrada del manager cuando delega con Silka (Code Mode) frente a
trabajar solo, y si se cumple la meta v1 (NFR-TOK-01: al menos 70% menos, con calidad igual o mejor).

## Qué se compara

- **Camino solo:** el manager resuelve cada tarea sin Silka.
- **Camino con Silka:** el manager delega la misma tarea con Silka (Code Mode).

Ambos caminos parten del mismo commit y usan las mismas instrucciones, definidas en
`scripts/benchmark/tasks.json` (3 tareas acotadas, cada una con su `verify`).

## Cómo se eligieron las tareas

Son cambios pequeños y reales sobre el propio repo, con un verify que ya existe en la suite
(`test/metrics.test.mjs`, `test/codemode.test.mjs`). Son pocas a propósito: el benchmark cuesta
cuota real y cada corrida ejecuta cada tarea dos veces. Cada tarea declara sus rutas `permitidos`
para contar los archivos fuera de alcance. Cambiar el archivo de tareas invalida la comparación con
informes anteriores; el informe guarda su sha256 para que se pueda verificar.

## Cómo se corre

```
node scripts/benchmark/run.mjs --help
node scripts/benchmark/run.mjs                      # solo muestra el plan, no gasta nada
node scripts/benchmark/run.mjs --confirmar-gasto    # corre los dos caminos (consume cuota real)
```

Opciones: `--modelo-solo <m>` y `--modelo-silka <m>` para fijar el modelo de cada camino.

Requisitos: el árbol de trabajo debe estar limpio (el benchmark parte de un commit), y `claude` debe
estar en el PATH. Cada tarea corre en un worktree temporal detached en ese commit.

## Qué se mide

- **Tokens del manager** (entrada, salida, caché y costo) del reporte que devuelve el proveedor
  (`claude -p --output-format json`). Nunca se estiman por caracteres. Si una corrida no trae uso,
  la celda dice "sin dato" y el informe no calcula ahorro.
- **Calidad** con la misma vara en los dos caminos: verify a la primera, reparaciones, roturas al
  mezclar y archivos fuera de alcance.

## Dónde queda el informe

`docs/benchmarks/<fecha>.md`: commit, sha256 de las tareas, modelos, tabla comparativa, ahorro,
veredicto de la meta del 70% y los límites de la medición. Un ahorro con peor calidad se muestra
como tal, nunca como mejora neta.

## Límites

- Solo cuenta los tokens del manager; los tokens internos de cada agente delegado quedan fuera.
- Una corrida por camino y por tarea: la varianza no está medida.
- Tareas pequeñas del repo: no representan todo el trabajo de un proyecto.
- Las cifras de reparaciones y roturas al mezclar quedan "sin dato" hasta que el runner de Silka las
  registre; sin ellas, la calidad no se puede declarar igual o mejor.
