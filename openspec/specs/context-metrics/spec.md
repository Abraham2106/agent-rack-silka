# context-metrics Specification

## Purpose
Contexto por referencia y métricas por tarea: cada agente arranca con contexto exacto, estable y cacheable; cada tarea deja datos medibles para tokens, calidad y línea base.

## Requirements

### Requirement: FR-CX-01 Paquete de repo cacheado
The system SHALL construir un paquete de repo por commit base, cacheado en `.silka/context/<sha>.md`, con estructura, convenciones, comandos de verify y bloque de estado.

#### Scenario: Mismo commit (T-CX-01)
- **WHEN** dos tareas usan el mismo commit base
- **THEN** comparten el mismo paquete (mismo hash) y orden

### Requirement: FR-CX-02 Orden estable del contexto
The system SHALL ensamblar en orden fijo: paquete de repo → convenciones → estado → encargo, sin marcas de tiempo en la parte estable.

#### Scenario: Orden y caché (T-CX-01)
- **WHEN** se arma el contexto de dos tareas
- **THEN** el prefijo estable es idéntico en orden y contenido

### Requirement: FR-CX-03 Punteros en el encargo
The system SHALL incluir en el encargo punteros a archivos y símbolos según `scope`, con ruta y motivo, no el contenido completo.

#### Scenario: Contexto ensamblado (T-CX-01)
- **WHEN** se lanza una tarea con scope definido
- **THEN** el encargo termina con punteros, no blobs enteros

### Requirement: FR-CX-04 Recuperación por referencia
The system SHALL permitir recuperar por `silka.get(ref)` todo lo no copiado al contexto, completo y sin pérdida.

#### Scenario: Referencia out (T-CM-03)
- **WHEN** una salida grande se referencia
- **THEN** `silka.get` devuelve el contenido íntegro

### Requirement: FR-CX-05 Presupuesto del paquete
The system SHALL omitir secciones enteras de menor prioridad si el paquete supera presupuesto, con puntero a la versión completa, sin cortes a mitad de sección.

#### Scenario: Sobre presupuesto (T-CX-02)
- **WHEN** el paquete excede el presupuesto
- **THEN** faltan secciones enteras y hay puntero a la versión completa

### Requirement: FR-CX-06 Proveedores opcionales
The system SHALL conectar proveedores de contexto (p. ej. Graphify) detrás de `ContextProvider` y permitir apagarlos.

#### Scenario: Ensamblado sin proveedor
- **WHEN** no hay proveedor activo
- **THEN** el contexto se arma solo con paquete local

### Requirement: FR-ME-01 Registro por tarea
The system SHALL anexar por tarea a `.silka/metrics.jsonl` id, agente, modelo, tokens, turnos, duración, verify, aprobación a primera, rotura al mezclar, interrupciones y fuente de cada número.

#### Scenario: Fuente explícita (T-ME-01)
- **WHEN** un dato no lo reporta la CLI
- **THEN** queda `null` con fuente "sin dato"

### Requirement: FR-ME-02 Sin estimación silenciosa
The system SHALL never estimar en silencio un dato faltante (ADR-0010).

#### Scenario: Null con fuente (T-ME-01)
- **WHEN** falta un campo en el reporte del agente
- **THEN** el JSONL registra null y la fuente correspondiente

### Requirement: FR-ME-03 Agregados por agente
The system SHALL exponer `silka.agents.stats(agent?, model?)` y vista `m` del TUI con éxito a la primera, tokens medianos y tiempo mediano.

#### Scenario: Stats API (test/codemode.test.mjs)
- **WHEN** se consulta `agents.stats`
- **THEN** devuelve agregados sin error de no implementado

### Requirement: FR-ME-04 Línea base
The system SHALL ofrecer procedimiento de línea base: N PRs reales con y sin Code Mode y paquete de contexto, comparando tokens y tasa de verify.

#### Scenario: Tabla comparable (T-ME-02)
- **WHEN** se ejecuta el procedimiento sobre 5 PRs
- **THEN** produce tabla comparable de tokens y tasa de verify

### Requirement: NFR-TOK-02 Acierto de caché del prefijo
The system SHALL registrar cuando el proveedor informa acierto de caché del prefijo estable como métrica de seguimiento de FR-CX-02.

#### Scenario: Registro de caché (T-CX-01)
- **WHEN** el proveedor reporta hit de caché
- **THEN** la métrica queda registrada si el proveedor lo soporta

### Requirement: NFR-QUA-01 Calidad intacta (contexto)
The system SHALL mantener la tasa de verify aprobados sin bajar frente a la línea base al usar el paquete de contexto.

#### Scenario: Línea base (T-ME-02)
- **WHEN** se compara con y sin paquete en la línea base
- **THEN** la tasa de verify no empeora

### Requirement: SEC-11 Redacción en paquete y métricas
The system SHALL pasar paquete de repo y métricas por el redactor de secretos antes de escribirse.

#### Scenario: Convenciones citadas (T-CX-01)
- **WHEN** se genera el paquete
- **THEN** las convenciones se citan del repo, no se inventan

### Requirement: SEC-05 Referencias opacas en contexto
The system SHALL resolver solo ids opacos emitidos por Silka, sin rutas arbitrarias en referencias de contexto.

#### Scenario: Puntero a completo (T-CX-02)
- **WHEN** se omite una sección por presupuesto
- **THEN** el puntero usa id opaco de Silka, no ruta del usuario