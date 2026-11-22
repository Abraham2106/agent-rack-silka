# Evals de Silka

Este documento explica cómo se aplican evals de calidad en Silka: qué medimos, con qué casos, cómo se
califican, cómo se usan como puerta de merge y qué parte está implementada hoy. El código vive en
[`evals/`](../evals/README.md).

## Benchmark de tokens y evals de calidad

Son dos cosas distintas y se complementan:

| | Benchmark de tokens | Evals de calidad |
|---|---|---|
| Pregunta | ¿Cuánto ahorra el manager al delegar con Silka? | ¿La salida (una clasificación, un resumen) es correcta? |
| Código | `scripts/benchmark/` | `evals/` |
| Documento | [`docs/benchmarks/README.md`](benchmarks/README.md) | este |
| Coste | Consume cuota real (`--confirmar-gasto`) | Por defecto ninguno (modelo fake) |
| Qué mide | Tokens del manager y calidad de las tareas delegadas | Precisión de casos con respuesta esperada |

El benchmark de tokens no se duplica aquí. Una tarea del benchmark que rompa la calidad debería
aparecer después como caso de eval, y un ahorro de tokens nunca compensa una precisión bajo el piso.

## Base conceptual

Estos siete puntos resumen las ideas de un curso sobre evals que tomamos como guía. Se aplican así en Silka:

**(a) Piso de precisión según el coste del error.** Antes de medir, se decide cuánta precisión exige la
decisión. Una clasificación de riesgo que manda un cambio peligroso sin revisión humana tiene un piso
alto (0.9 o más). Un resumen que el revisor lee de todos modos puede tener uno menor.
*En Silka:* el piso es `--piso` del runner (por defecto 0.9) y se aplica por suite.
*Estado:* implementado.

**(b) Modelo más barato que supere el piso, medido por coste por tarea completada.** No se elige el
modelo más capaz, sino el más barato que pase el piso. El coste se mide por tarea completa, no por llamada.
*En Silka:* el runner registra tokens y coste **si el proveedor los reporta**; si no, escribe "sin dato".
El enrutado de modelos por tarea es la propuesta [`openspec/changes/model-routing`](../openspec/changes/model-routing).
*Estado:* registro implementado; comparar modelos y enrutar, **después**.

**(c) Conjunto pequeño con datos propios y respuestas esperadas.** Unos cinco a diez casos bien
elegidos valen más que cien genéricos. Los casos salen de reglas reales del repo, no de ejemplos inventados.
*En Silka:* [`evals/cases/riesgo.jsonl`](../evals/cases/riesgo.jsonl) (10 casos de `src/silka/tasks/risk.mjs`)
y [`evals/cases/resumen.jsonl`](../evals/cases/resumen.jsonl) (5 casos de resumen de cambios).
*Estado:* implementado. Los casos de resumen son entradas de ejemplo; todavía no vienen de tareas reales.

**(d) Campos exactos con código, texto libre con juez y rúbrica.** Si la respuesta es un campo cerrado
(nivel de riesgo, una lista de razones), se compara con código: es barato, determinista y no discute.
Si es texto libre, un juez califica cada criterio de una rúbrica.
*En Silka:* [`evals/graders/exact.mjs`](../evals/graders/exact.mjs) y
[`evals/graders/rubric.mjs`](../evals/graders/rubric.mjs), con la interfaz `judge(output, rubric)`.
El juez por defecto es simulado y determinista (busca palabras de cada criterio). El juez real con
OpenCode (`--juez opencode`, modelo `opencode/hy4-flash-free`) es opcional y nunca obligatorio.
*Estado:* implementado, con el juez simulado. El juez real está escrito, pero no se ha ejecutado contra la red.

**(e) Arreglar el prompt con los casos fallidos antes de subir de modelo.** Cuando un caso falla, el
primer paso es mirar el prompt y las instrucciones, no cambiar de modelo. El informe indica qué caso falló
y en qué campo.
*En Silka:* el informe lista los fallos con su id y, en los exactos, el campo, el valor esperado y el obtenido.
*Estado:* el informe está implementado; el flujo de revisión de prompts es una práctica, no código.

**(f) Bloquear un merge si el smoke eval puntúa bajo.** El subconjunto `smoke: true` es corto y rápido.
Si su precisión queda bajo el piso, el pull request no se puede fusionar.
*En Silka:* `npm run evals:smoke` sale con 1 bajo el piso. El workflow
[`.github/workflows/evals-smoke.yml`](../.github/workflows/evals-smoke.yml) lo corre en cada pull request
con el modelo fake: sin red, sin secretos y sin coste.
*Estado:* el workflow está en el repo; todavía no se ha ejecutado en GitHub. La puerta de merge
solo se activa cuando el repo lo tenga como check obligatorio en la configuración de ramas.

**(g) Suite completa por la Batch API cuando nadie espera.** Las evals completas, con modelos reales,
se envían en lote a la Message Batches API. Es más barato y el resultado llega después.
*En Silka:* [`evals/batch.mjs`](../evals/batch.mjs) arma la petición con todos los casos. Con `--dry-run`
muestra el JSON sin enviarlo. Sin `ANTHROPIC_API_KEY` sale con 0 y un aviso. Con la clave, crea el lote.
*Estado:* esqueleto. Crear el lote no se ha probado contra la API. Consultar el estado y descargar
resultados, y volcarlos al informe, queda **después**.

## Qué está implementado hoy y qué se aplicará después

**Implementado hoy**
- Runner `evals/run.mjs` con suites `exact` y `rubric`, `--smoke`, `--piso`, `--modelo`, `--json`.
- Informe en `evals/reports/` (ignorado por git salvo `.gitkeep`).
- Modelo `fake` determinista por defecto. Su función es probar el runner y las reglas, no medir un LLM.
- Juez simulado con rúbrica. Juez real con OpenCode escrito, no probado con red.
- Casos de `riesgo` (risk.mjs) y de `resumen` (texto libre).
- Pruebas en `test/evals.test.mjs`, que corren en `npm test`.
- `batch.mjs` con `--dry-run` y aviso sin clave.
- Workflow de smoke en pull requests.

**Se aplicará después**
- Casos de la ficha de tarea (campos exactos de la ficha generada) y de la clasificación real con modelo.
- Resumen de cambios generado por Silka, en lugar de entradas de ejemplo.
- Casos del revisor de [`review-guardrails`](../openspec/changes/review-guardrails) y del enrutado de
  [`model-routing`](../openspec/changes/model-routing), cuando esos cambios existan.
- Comparación de modelos por coste por tarea completada (punto b).
- Consulta y volcado de resultados del lote de la Batch API (punto g).
- Smoke eval con el juez real como check obligatorio, si el coste lo justifica.

## Cómo añadir un caso

Cada línea de `evals/cases/*.jsonl` es un caso. Ejemplo de campos exactos:

```json
{"id":"riesgo-011","suite":"exact","tipo":"riesgo","smoke":true,
 "entrada":{"verifyOk":true,"files":["package.json"],"outOfScope":[],"diffLines":5,"allowNoVerify":false},
 "esperado":{"level":"alto","requiresHuman":true,"reasons":["archivos_sensibles"]}}
```

Ejemplo de texto libre con rúbrica:

```json
{"id":"resumen-006","suite":"rubric","tipo":"resumen","entrada":{"archivos":["x.mjs"],"motivo":"...","verify":"npm test"},
 "rubrica":{"minimo":0.8,"criterios":[{"id":"archivos","descripcion":"Nombra los archivos cambiados","palabras":["x.mjs"]}]}}
```

Reglas: el `id` es único en toda la carpeta; `esperado` solo lista los campos que importan; los campos
no listados se ignoran. Un caso que pida un `tipo` distinto de los existentes falla con un mensaje claro
hasta que el modelo fake lo soporte. Antes de añadir un caso de riesgo, lee `src/silka/tasks/risk.mjs` y
comprueba a mano que el resultado esperado se cumple de verdad.

## Cómo leer el informe

```
evals · modelo fake · juez simulado · piso 0.90
exact   10/10  100.0%  OK
rubric   5/5  100.0%  OK
coste: tokens_entrada=sin dato tokens_salida=sin dato usd=sin dato
informe: .../evals/reports/2026-11-22_23-43-56.json
resultado: OK (salida 0)
```

- `ok/total` y la precisión por suite. `BAJO PISO` marca la suite que no llega al piso.
- `fallos:` lista los casos que fallaron, como `exact/riesgo-003`. En el JSON, cada caso tiene
  `diferencias` (campo, esperado, obtenido) o `error` si el modelo no respondió.
- `coste: sin dato` es lo correcto cuando el proveedor no reporta uso. Nunca se estima.
- Códigos de salida: `0` sobre el piso, `1` bajo el piso, `2` error de uso o de configuración.

## Cómo fijar el piso

El piso sale de la pregunta (a): cuánto cuesta un error. Va en `--piso` y, para el smoke de pull requests,
en el workflow. Un piso alto con pocos casos hace que un solo fallo bloquee. Por eso el smoke debe ser
pequeño y estable, y la suite completa, la que decide cambios de modelo, debe ser más amplia.
`--piso 1.01` es un atajo para comprobar que el bloqueo funciona: siempre sale con 1.

## Cómo se conecta con CI y con la Batch API

- **CI (smoke bloqueante):** `npm run evals:smoke` en cada pull request. Sale con 1 si cae bajo el piso.
  Modelo fake, sin secretos. Es el mismo comando que se corre en local.
- **Batch API (suite completa):** `node evals/batch.mjs` cuando haya `ANTHROPIC_API_KEY`. Con
  `--dry-run` se revisa la petición antes de enviarla. El lote no bloquea un pull request: su resultado
  llega cuando termina.

## Límites

- Con el modelo fake, los casos de riesgo están sincronizados con `risk.mjs` por construcción: prueban que
  las reglas no cambian sin aviso, no que un LLM las aplique bien.
- El juez simulado busca palabras; no entiende el texto. Por eso el juez real existe, aunque hoy no esté probado.
- Diez casos por suite no dan una cifra estadísticamente sólida. Sirven para detectar regresiones grandes.
- Un informe sin `coste` no permite comparar modelos por precio: hasta tener datos del proveedor, la
  comparación de costes queda pendiente.
