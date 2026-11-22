# Visión de arquitectura

## 1. Contexto (C4 nivel 1)

```mermaid
flowchart LR
  U[Builder] -->|TUI / CLI| S((Silka))
  M[Manager: Claude Code u otro harness] -->|MCP: silka bridge| S
  S -->|lanza y conversa| A1[Codex CLI]
  S --> A2[Cursor CLI]
  S --> A3[OpenCode CLI]
  S -->|git worktree, verificaciones| R[(Repositorio del builder)]
  A1 & A2 & A3 -->|APIs de modelos| P[Proveedores LLM]
```

Actores: el **builder** (humano), el **manager** (un harness que delega) y los **agentes** (CLIs que ejecutan). Silka no llama a modelos por sí mismo: orquesta procesos de agentes y opera sobre el repositorio.

## 2. Contenedores (C4 nivel 2)

| Contenedor | Proceso | Responsabilidad | Estado que posee |
|---|---|---|---|
| **Hub** (`silka hub`) | Node, uno por máquina y puerto | Sesiones (vía agent-rack), despachador de cola, cola de mezcla (F4) | Sesiones en memoria (agent-rack) |
| **Bridge** (`silka bridge`) | Node, uno por cliente MCP | Proxy MCP al hub; Code Mode (F1); permisos, guarda de profundidad | Ninguno persistente |
| **Sandbox de Code Mode** | Node con `--permission`, efímero | Ejecuta el programa del manager contra la API `silka` por IPC | Ninguno |
| **Shim** (`shims/agent-shim.mjs`) | Node, uno por turno de agente | Traduce cada CLI, captura eventos, estado, historial, interrupciones | Escribe `.silka/`, historiales |
| **TUI** (`silka ui`) | Node + Ink | Vista y control humano | Ninguno (lee) |
| **Almacén de archivos** | Disco | `~/.config/silka/*` (global) y `<workspace>/.silka/*` (por repo) | Cola, notas, orígenes, historiales, tareas, decisiones, métricas |

## 3. Componentes de v1 (C4 nivel 3, dentro de Hub y Bridge)

```mermaid
flowchart TB
  subgraph Bridge
    CM[CodeMode: search/execute] --> API[API silka tipada]
    API --> PERM[Política: workspaces, profundidad, lista blanca]
  end
  subgraph Hub
    SES[Sesiones agent-rack]
    DSP[Despachador de cola]
    TSK[Gestor de tareas F2: worktree + verify + ficha]
    RVW[Bandeja F3]
    MQ[Cola de mezcla F4: escritor único]
    CTX[Paquete de contexto F5]
    MET[Métricas F5]
  end
  PERM -->|IPC| SES & TSK & RVW & MQ & CTX & MET
  TSK --> SES
  RVW --> MQ
  MQ -->|devuelve con error| SES
```

## 4. Flujos principales

**Encargar en lote (F1 + F2):**
1. El manager llama `silka_execute(code)`.
2. El bridge abre el sandbox, y el código llama `silka.launch(plan)`.
3. Por cada tarea se crea un worktree y una sesión. `waitAll` espera en el hub sin bloquear el sandbox.
4. Al terminar cada tarea se corre `verify` y se genera la ficha.
5. El código filtra y devuelve solo las fichas.

**Revisar y mezclar (F3 + F4):**
1. El builder abre la bandeja y aprueba o rechaza.
2. Lo aprobado entra a la cola de mezcla, que es un escritor único.
3. La cola hace rebase, re-verifica y mezcla. Si algo falla, devuelve la tarea a su sesión con el error.

## 5. Atributos de calidad priorizados

Detallados en [atam.md](atam.md).

1. **Eficiencia de tokens por diseño** (sin pérdida de calidad).
2. **Seguridad**: sandbox, fronteras de confianza, nada de ejecución fuera de lo permitido.
3. **Corrección bajo concurrencia**: ninguna entrega duplicada ni perdida, ninguna mezcla corrupta.
4. **Productividad del builder**: tiempo para encargar y revisar.
5. **Mantenibilidad**: núcleo pequeño, dependencias mínimas.
6. **Portabilidad**: Windows de primera clase, macOS y Linux.
