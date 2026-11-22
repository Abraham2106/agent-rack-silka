Tarea: fase 4 de Silka, el diferenciador. Un estado compartido y verificable del proyecto, para que ningún agente trabaje sobre supuestos viejos. Graphify entra como proveedor de contexto opcional.

Idea guía: los modelos van a entender cada vez mejor el código, pero alguien tiene que saber QUÉ cambió, CUÁNDO, QUIÉN lo cambió y si las conclusiones de cada agente siguen siendo válidas. Eso es estado y coordinación, no inteligencia. Silka debe funcionar perfecto SIN Graphify y mejorar CON él.

Contexto (ya hecho):
- `src/silka/`: hub, TUI, steer, notas, `bridge.mjs` (proxy MCP al hub; agrega `silka_notes`), `connect.mjs` y `origin.mjs` (`~/.config/silka/sessions.json` con from/depth).
- `shims/agent-shim.mjs` es el camino por el que pasa TODA sesión: Claude Code vía bridge, TUI, `silka run` y `scripts/delegate.mjs`. Conoce el cwd (workspace) y el prompt, y puede anteponer contexto.
- Codex corre como passthrough en el shim (stdout JSONL que agent-rack parsea).

Alcance: `src/silka/`, `shims/agent-shim.mjs`, `scripts/setup.mjs`, `.gitignore`, README.md y `skills/delegar/SKILL.md`.

Entrega:
1. Estado compartido por workspace, en `<workspace>/.silka/` (agrega `.silka/` al .gitignore del repo).
   - `tasks.json`: por cada sesión, agente, origen, rama, commit base (HEAD al empezar), inicio, fin, estado, archivos tocados y resumen corto.
   - Archivos tocados: diferencia entre el snapshot de `git status --porcelain` más hashes al empezar y al terminar el turno. Si dos agentes trabajan a la vez en el mismo árbol, atribúyelos lo mejor posible y marca la ambigüedad.
   - `decisions.jsonl`: decisiones con autor, fecha, sesión y texto.
2. Contexto fresco automático. Al iniciar cada turno, el shim antepone al prompt un bloque compacto (15 líneas como máximo) "Estado del proyecto (silka)" con:
   - rama y HEAD;
   - qué cambiaron otros agentes desde la última vez que esta sesión trabajó (o en las últimas 2 horas): agente, archivos y resumen de una línea;
   - tareas en curso con sus archivos;
   - las últimas 3 decisiones.
   Si el workspace no es un repo git, el bloque es mínimo. Nada de volcar archivos enteros: tiene que costar pocos tokens.
3. Conflictos. Si dos tareas en curso tocan el mismo archivo, el TUI lo marca y se crea una nota automática para el manager.
4. Herramientas MCP nuevas en el bridge:
   - `silka_state({workspace})`: el mismo resumen compacto;
   - `silka_changes({workspace, since?})`;
   - `silka_decide({workspace, text})`;
   - `silka_decisions({workspace, limit})`.
   Documéntalas en `skills/delegar/SKILL.md`.
5. TUI: una vista "Estado" (tecla `e`) con rama, HEAD, tareas, archivos tocados, conflictos y decisiones. Que sea legible y consistente con el resto.
6. Graphify (opcional).
   - Verifica primero el paquete oficial: PyPI `graphifyy` / repo `graphify-labs/graphify`. Revisa su README antes de usarlo.
   - Si Python está disponible, instálalo con `pip install --user`.
   - Agrega `silka graph build|status [workspace]`, que genera el grafo con su CLI dentro del workspace, y `silka connect <harness> --with-graph`, que registra además el MCP de Graphify en ese harness.
   - Si existe el grafo, el bloque de estado agrega UNA línea que dice dónde está y qué herramientas usar.
   - Si Graphify no está instalado, todo funciona igual y `silka graph status` lo dice con claridad.
7. Arreglos de la fase 3:
   a. Profundidad. Codex no pasa `SILKA_DEPTH` a sus servidores MCP, así que las sesiones que Codex lanza quedan con depth 0. Revisa si `codex mcp` permite reenviar variables de entorno (por ejemplo una clave `env_vars` en `~/.codex/config.toml`) y si cursor/opencode tienen algo parecido. Si no, el bridge infiere al padre: la sesión running del mismo agente y workspace. Guarda `parentSessionId` y `depth = depth del padre + 1` en `sessions.json`, y anida en el TUI.
   b. Tokens. El summary de Codex incluye el JSON crudo de sus `mcp_tool_call` y otros items. En el shim, filtra el stdout de Codex: los items que no sean el mensaje final van a stderr como pasos legibles (`→ mcp agent-rack.opencode_run`, `→ $ cmd`), y a stdout solo lo necesario para que agent-rack obtenga el texto final.
8. README: secciones "Estado compartido" y "Graphify (opcional)".

Prueba (córrela tú):
- IMPORTANTE: el hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node.
- En `sandbox/` (`git init` si hace falta), lanza dos sesiones de opencode, una tras otra, que editen archivos distintos. La segunda debe recibir el bloque de estado con el cambio de la primera; verifícalo en el log del shim. Después dos a la vez sobre el mismo archivo: debe aparecer el conflicto en el TUI y la nota.
- `silka_decide` + `silka_state` vía un cliente MCP contra `silka bridge`.
- Codex lanzando opencode por el bridge: queda con parentSessionId y depth 1, y el summary de Codex sale corto.
- `silka graph status` con y sin Graphify.
- `node --check` en todo y `npm run smoke` (los tres agentes deben pasar).

Al terminar responde en 12 líneas o menos: archivos, qué probaste, qué funcionó y qué no, qué instalaste y cualquier config externa que modificaste.
