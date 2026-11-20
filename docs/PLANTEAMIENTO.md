# Planteamiento: "CLI-Anything para agentes"

Claude es el jefe. Codex, OpenCode y Cursor son contratistas. Claude les delega trabajo
con **una sola llamada de herramienta** (un tool call MCP), sigue con lo suyo y al final
recibe un **reporte corto y verificado**. Claude no lee el razonamiento ni el log del otro
agente, porque eso es justo lo que gasta tokens.

## 1. Lo que hay en tu máquina (verificado)

| Agente | Binario | Versión | Modo headless | Salida para máquinas | Aislamiento |
|---|---|---|---|---|---|
| Codex | `codex` | 0.159.3 | `codex exec "<prompt>"` | `--json` (JSONL), `-o <archivo>` (solo el último mensaje), **`--output-schema <json>`** | `-C <dir>`, `-s workspace-write`, `--ephemeral` |
| OpenCode | `opencode` | 1.14.46 | `opencode run "<prompt>"` | `--format json` (eventos) | `--dir <dir>`, `opencode serve` + `--attach` (servidor persistente) |
| Cursor | `cursor-agent` / `agent` | 2026.11.11 | `cursor-agent -p "<prompt>"` | `--output-format json \| stream-json` | `--workspace <dir>`, **`-w/--worktree`**, `--trust`, `--force` |

Los tres ya tienen modo headless oficial, así que no hace falta "hackear" nada. Lo que falta
es **una capa común** que los vuelva intercambiables y baratos para Claude.

## 2. Qué existe ya en GitHub (y qué le falta)

- **agent-mcp-hub**: junta `codex exec`, `cursor-agent -p` y `opencode run` en un MCP. Es lo más parecido a tu idea, pero es un "pasa-prompts": no tiene contrato de entrega ni verificación.
- **codex-as-mcp**, **subcodex-mcp**, **claude-codex-meight**, **codexmcp**: solo funcionan con Codex. subcodex detecta cuándo el agente se queda pegado, y vale la pena copiar esa idea.
- **opencode-mcp**: solo OpenCode, en modo asíncrono contra el servidor headless.
- **cursor-delegate-mcp**: solo Cursor.
- **sub-agents-mcp**: los agentes se definen en markdown y tiene varios backends. Su idea de "perfil de agente" es buena.

**El hueco que llena tu idea:** ninguno combina las tres cosas que hacen que delegar sea barato:
1. un **contrato de tarea** corto y estándar (alcance, entregable, cómo probar, dónde trabajar),
2. **verificación hecha por la capa, no por el agente** (la capa corre el test y no le cree al agente),
3. un **reporte comprimido** con forma fija, sin el transcript.

## 3. Cómo funciona

```
Claude ──tool call──▶  MCP "delegar"  ──spawn──▶ codex exec / opencode run / cursor-agent -p
   ▲                       │                          (en su propio git worktree)
   │                       ├─ espera / detecta si se pegó / timeout
   │                       ├─ corre el comando de verificación (tests)
   └──── reporte ~200 tok ─┴─ calcula diff --stat, recorta, devuelve JSON
```

### Herramientas que ve Claude (solo 3)

**`delegate`**: lanza el trabajo y responde de una con un `job_id` (asíncrono).
```json
{
  "agent": "codex | opencode | cursor | auto",
  "task": "Agregar paginación al endpoint /users",
  "scope": "Solo src/api/users/*; no tocar el esquema de la DB",
  "deliver": "Endpoint con ?page&limit y tests nuevos",
  "verify": "npm test -- users",
  "workdir": "C:/repo",
  "isolation": "worktree",
  "budget": { "minutes": 20 }
}
```
Son cinco campos que se llenan en una línea cada uno. No es una especificación completa:
le dice al agente qué hacer, qué entregar, cómo se va a probar y dónde.

**`wait`** (`job_id`, `timeout_s`): bloquea hasta que termina y devuelve el reporte.
Así Claude no hace *polling* ni gasta turnos monitoreando.

**`result`** (`job_id`, `detail: "summary" | "diff" | "log_tail"`): si algo salió mal,
Claude pide más detalle **solo en ese caso**.

### El reporte (lo único que entra al contexto de Claude)
```json
{
  "status": "ok | failed_verify | timeout | stuck",
  "agent": "codex",
  "branch": "delegate/ab12-paginacion",
  "summary": "Agregué page/limit con defaults 1/20, validación y 4 tests.",
  "files": "3 changed, +142 −8",
  "verify": { "cmd": "npm test -- users", "exit": 0, "tail": "Tests: 12 passed" },
  "duration_s": 312
}
```
El `summary` sale del último mensaje del agente, forzado a JSON:
- Codex: `--output-schema` + `-o last.json` (nativo, ideal).
- Cursor: `--output-format json`, se toma el campo `result`.
- OpenCode: `--format json`, se toma el último evento de texto.

Los tres reciben el mismo *prompt envoltorio*, que termina con: "Al final responde SOLO con
este JSON: {summary, files_touched, notes}".

## 4. Decisiones clave

1. **Cada trabajo en su propio git worktree**, en la rama `delegate/<id>`. Así se pueden correr
   varios agentes en paralelo sin pisarse, y Claude decide si hace *merge*. Para Cursor
   se usa su `--worktree` nativo y para los otros `git worktree add`.
2. **La verificación es de la capa.** El agente dice "listo", pero lo que cuenta es el `exit`
   del comando `verify`. Esto es lo que te deja no monitorear.
3. **Detección de "pegado"**: si el stream JSON no emite eventos en N minutos, o se pasa del
   presupuesto, se mata el proceso y se reporta `stuck` con las últimas 20 líneas.
4. **Permisos explícitos por agente**: Codex corre con `-s workspace-write` (nunca con
   `--dangerously-bypass...`), Cursor con `--trust` (`--force` solo dentro del worktree) y OpenCode con su perfil de agente.
5. **`agent: "auto"`**: un router simple por reglas (por ejemplo, tareas de UI → Cursor,
   refactors largos → Codex, modelos locales o baratos → OpenCode), configurable en un YAML.
6. **Adaptadores enchufables**: cada agente es un archivo de ~50 líneas (`build_cmd`,
   `parse_final`). Agregar Gemini CLI, Aider, etc. es solo un archivo más. Eso es lo de "CLI-Anything".

## 5. Stack sugerido

- **Node/TypeScript** con `@modelcontextprotocol/sdk`. Ya tienes Node y los tres CLIs son de npm.
- Estado de los trabajos en `~/.delegate/jobs/<id>/` (prompt, stdout.jsonl, report.json),
  para poder reanudar o auditar sin cargarlo en el contexto.
- Se registra en Claude Code con `claude mcp add delegate -- node dist/server.js`.

## 6. Plan de construcción

1. **MVP (1 día)**: `delegate` + `wait` con un solo adaptador (Codex, porque tiene `--output-schema`) y worktree + verify.
2. Adaptadores de Cursor y OpenCode con el mismo contrato.
3. Detección de "pegado", presupuesto de tiempo y `result(detail)`.
4. Router `auto`, paralelo (varios `delegate` y luego un `wait` de todos) y un skill de Claude
   que le enseñe cuándo delegar y cómo escribir los 5 campos.

## 7. Riesgos

- **Autenticación**: cada CLI usa su propio login y cuota (ChatGPT, Cursor, el proveedor de OpenCode). La capa no maneja llaves, solo usa sesiones que ya existen.
- **Windows**: los CLIs son wrappers `.ps1`/`.cmd`, así que hay que llamarlos con `shell: true` o por `node <ruta del bin>`. Esto se resuelve en cada adaptador.
- **Calidad del entregable**: si el `verify` es débil, el reporte "ok" engaña. El skill debe exigirle a Claude un `verify` real.
