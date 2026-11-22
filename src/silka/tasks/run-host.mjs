// Proceso que sostiene un `run` de la receta en Windows (FR-TK-15). Lo lanza Silka con `detached`, y él
// lanza el shell de la receta sin `detached` y espera a que termine. Hace falta por dos cosas medidas:
// - powershell.exe no arranca bien con `detached` (muere al instante), así que el shell no se lanza
//   detached directamente;
// - un hijo sin `detached` muere cuando sale quien lo lanzó (el CLI, por ejemplo). Este proceso sí
//   sobrevive a su padre, y así también el shell que sostiene.
// El pid de este proceso es el del run: `taskkill /T` sobre él cierra todo el árbol.
import { spawn } from 'node:child_process';

const job = JSON.parse(process.argv[2] || '{}');
const child = spawn(job.file, job.args, {
  stdio: 'inherit',
  windowsHide: true,
  windowsVerbatimArguments: Boolean(job.verbatim),
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
