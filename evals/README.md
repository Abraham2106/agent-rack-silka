# Evals de Silka

Cómo se aplican y qué hay en esta carpeta: [`docs/evals.md`](../docs/evals.md).

## Comandos

```
npm run evals          # suite completa (exact + rubric), modelo fake, sin red ni coste
npm run evals:smoke    # solo los casos marcados smoke: true (es lo que bloquea un pull request)
node evals/run.mjs --suite exact --piso 0.95 --json
node evals/batch.mjs --dry-run     # muestra la petición de la Batch API; no envía nada
```

El runner sale con `0` si cada suite llega al piso, con `1` si alguna queda bajo el piso y con `2` si hay
un error de uso. El informe se guarda en `evals/reports/` (ignorado por git salvo `.gitkeep`).

## Estructura

- `run.mjs`: CLI. `lib/runner.mjs`: motor. `lib/casos.mjs`: carga y validación de casos.
- `modelos.mjs`: adaptadores (`fake` por defecto; `opencode/hy4-flash-free` opcional).
- `graders/exact.mjs`: campos exactos con código. `graders/rubric.mjs`: juez con rúbrica (`judge(output, rubric)`).
- `cases/*.jsonl`: casos. `batch.mjs`: envío de la suite por la Batch API (requiere `ANTHROPIC_API_KEY`).
