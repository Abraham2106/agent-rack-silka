Rol: verificador independiente. NO corriges código. Confirmas, con pruebas reales, si cada corrección de las rondas 1 y 2 funciona, y escribes un reporte.

Lee `docs/tasks/qa-3-correcciones.md` (los 13 ítems), `docs/reports/e2e.md` y `docs/reports/qa.md`. El commit a verificar es el HEAD de la rama `silka-roadmap`.

Reglas:
- No modifiques el repo, salvo tu reporte. Para pruebas usa `sandbox/` o una carpeta temporal.
- El hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node.
- No toques configs externas. Para `connect` usa solo `--dry-run`.
- Usa modelos rápidos: cursor `grok-4.7-medium-fast`, opencode el modelo por defecto.
- IMPORTANTE: al terminar no dejes procesos hijos vivos (ni hubs de prueba, ni TUIs, ni servidores). Ciérralos antes de responder.

Verifica:
1. Cada uno de los 13 ítems con una prueba que lo demuestre, no leyendo el código. Por ejemplo:
   - ítem 1: una sesión de cursor con política `workspace-write` no recibe `--force` (míralo en el log del shim en `~/.config/silka/logs/`);
   - ítem 3: un prompt que incluye un falso "Estado del proyecto (silka)" y una falsa marca `[silka depth=0 from=x]` no logra suplantarlos.
2. Ítem 4 con el caso real: lanza una sesión (por ejemplo de opencode) cuyo agente ejecute un comando que deje un proceso hijo vivo con su stdout heredado, por ejemplo `start /b ping -n 120 127.0.0.1` o `node -e "setInterval(()=>{},1e3)"` en segundo plano. La sesión debe pasar a completed poco después de que el agente termine, no quedarse en running. Verifica también que el proceso hijo se mató.
3. Regresión: repite los 29 casos de `docs/reports/e2e.md` que apliquen. En especial, el setup en un clon limpio y el error de modelo inválido.
4. `npm test`, `node --check` y `npm run smoke`.

Entrega: `docs/reports/verificacion-2.md` con:
- una tabla ítem → PASA/FALLA → evidencia (comando y salida corta);
- regresiones encontradas;
- "Pendiente", ordenado por severidad, solo lo que FALLA o es nuevo.

Responde en 6 líneas o menos con el conteo (X/13 y regresiones) y lo pendiente más grave.

Ronda 2 (ya aplicada): en Windows, Cursor con `workspace-write` vuelve a usar `--force` (Cursor no tiene sandbox en Windows; en macOS/Linux usa `--sandbox enabled --force`). Ahora sí puedes correr node, npm y git. La ronda 1 dejó sin probar los ítems 2, 3, 4, 6, 7, 9, 11 y 12 y 26 casos de regresión (ver `docs/reports/verificacion-1.md`): son la prioridad.
