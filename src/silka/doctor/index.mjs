// `silka doctor`: revisa el entorno de Silka y dice, por punto, si está bien, qué falla y cómo
// arreglarlo. Solo lee: ningún punto modifica archivos, procesos ni configuración (DR-04).
import { defaultChecks, makeContext } from './checks.mjs';
import { point, STATUS, summarize, toJson, toText } from './result.mjs';

/** Ejecuta cada comprobación. Una que lanza no tumba el diagnóstico: queda como falla. */
export async function runChecks(checks, ctx) {
  const points = [];
  for (const check of checks) {
    try {
      const out = await check(ctx);
      points.push(...(Array.isArray(out) ? out : [out]));
    } catch (err) {
      points.push(point({
        id: check.name || 'comprobacion',
        name: check.name || 'Comprobación',
        status: STATUS.FAIL,
        cause: `la comprobación falló: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'revisa el error y vuelve a correr silka doctor',
      }));
    }
  }
  return points;
}

/**
 * Corre el diagnóstico y devuelve { points, exitCode, output } sin imprimir nada.
 * `ctx` puede sustituir piezas (las pruebas lo usan); por defecto, el entorno real.
 */
export async function diagnose({ json = false, checks = defaultChecks(), ctx } = {}) {
  const context = ctx ?? await makeContext();
  const points = await runChecks(checks, context);
  return {
    points,
    exitCode: summarize(points).exitCode,
    output: json ? toJson(points) : toText(points),
  };
}

/** Subcomando `silka doctor [--json]`. Devuelve el código de salida (1 si hay alguna falla). */
export async function doctorCommand(args = []) {
  const { output, exitCode } = await diagnose({ json: args.includes('--json') });
  console.log(output);
  return exitCode;
}
