# code-mode Specification

## Purpose
Delegación en lote vía Code Mode: el manager encarga, espera y filtra el trabajo de N agentes en una sola ida y vuelta mediante `silka_search` y `silka_execute`, con API tipada, sandbox aislado y salidas por referencia.

## Requirements

### Requirement: FR-CM-01 Búsqueda acotada de la API
The system SHALL devolver solo los fragmentos relevantes de `silka.d.ts` (firmas y JSDoc) para la consulta, con un máximo de 4 KB.

#### Scenario: Fragmentos y versión (T-CM-01)
- **WHEN** el manager invoca `silka_search(query)`
- **THEN** la respuesta incluye la versión semver de la API y fragmentos acotados a 4 KB

### Requirement: FR-CM-02 Ejecución en sandbox
The system SHALL ejecutar el programa del manager en el sandbox (ADR-0004) y devolver su valor de retorno serializado a JSON.

#### Scenario: Lote con launch (T-CM-01)
- **WHEN** `silka_execute` lanza varias tareas en un solo programa
- **THEN** cada tarea se registra y el resultado JSON refleja las fichas o errores tipados

### Requirement: FR-CM-03 Salida por referencia
The system SHALL guardar salidas mayores de 8 KB completas y devolver `{ ref: "out:<id>", bytes, preview }` sin truncar sin referencia.

#### Scenario: Recuperación idéntica (T-CM-03)
- **WHEN** la salida supera 8 KB
- **THEN** `silka.get(ref)` recupera la salida completa idéntica al contenido almacenado

### Requirement: FR-CM-04 Superficie de la API
The system SHALL exponer la superficie de silka-v1 §3.1: `plan`, `launch`, `wait`, `waitAll`, `status`, `card`, `get`, `send`, `cancel`, `review.*`, `merge.*`, `state.*`, `agents.*`.

#### Scenario: Cola expuesta (merge.queue en lote)
- **WHEN** el programa en Code Mode consulta `merge.queue`
- **THEN** obtiene la cola y estados sin herramientas MCP adicionales

### Requirement: FR-CM-05 Errores íntegros y tipados
The system SHALL devolver errores con mensaje, línea del código del manager y código tipado (`E_SCOPE`, `E_POLICY`, `E_LIMIT`, `E_NOT_FOUND`, `E_CONFLICT`, `E_SYNTAX`, `E_HUB`) cuando aplique.

#### Scenario: Módulo denegado (T-SEC-04)
- **WHEN** el código importa `net` en el sandbox
- **THEN** falla con `E_POLICY` indicando módulo no permitido

### Requirement: FR-CM-06 Esperas largas en el hub
The system SHALL resolver `wait` y `waitAll` en el hub; el sandbox solo espera la respuesta por IPC sin consumir CPU en espera activa.

#### Scenario: Desconexión MCP (T-CM-04)
- **WHEN** el cliente MCP se desconecta a mitad de ejecución
- **THEN** el sandbox termina y las tareas lanzadas siguen vivas en el hub

### Requirement: FR-CM-07 Compatibilidad MCP
The system SHALL mantener las herramientas MCP actuales sin cambios de comportamiento para clientes existentes.

#### Scenario: Regresión de suite
- **WHEN** se ejecuta `npm test` en el repositorio
- **THEN** las pruebas del bridge y Code Mode pasan junto al resto de la suite

### Requirement: FR-CM-08 Versión de silka.d.ts
The system SHALL versionar `silka.d.ts` con semver e informar la versión en cada respuesta de `silka_search`.

#### Scenario: Versión en search
- **WHEN** se invoca `silka_search`
- **THEN** la respuesta incluye la versión semver actual de la API tipada

### Requirement: FR-CM-09 Auditoría de ejecuciones
The system SHALL registrar cada ejecución (id, autor, duración, llamadas IPC, bytes devueltos) en auditoría, redactando el código si contiene secretos.

#### Scenario: Límite IPC (T-SEC-07)
- **WHEN** se exceden las llamadas IPC permitidas
- **THEN** la ejecución falla con `E_LIMIT` y queda trazable en auditoría

### Requirement: FR-CM-10 Resultado de wait con último mensaje del turno
The system SHALL devolver en `wait` y `waitAll` el `lastMessage` del turno más reciente, el número de `turn`, y `noText: true` cuando el turno terminó sin texto.

#### Scenario: Turno reanudado tras send (test/codemode.test.mjs)
- **WHEN** el manager espera tras un `silka.send` en la misma sesión
- **THEN** `lastMessage` corresponde solo al turno actual, no a uno anterior ni vacío indebidamente

### Requirement: NFR-TOK-01 Ahorro de tokens del manager
The system SHALL lograr al menos un 70 % menos de tokens de entrada del manager que las herramientas MCP actuales en el escenario de lote de 5 tareas (lanzar, esperar y fichas).

#### Scenario: Medición simulada (T-CM-02)
- **WHEN** se compara un lote de 5 tareas en Code Mode frente a MCP en la misma simulación
- **THEN** el ahorro estimado es ≥ 70 %

### Requirement: NFR-PERF-01 Encargo en lote
The system SHALL lanzar 5 tareas en menos de 2 minutos desde la llamada de encargo.

#### Scenario: Lote con hub falso
- **WHEN** se ejecuta un lote de cinco lanzamientos vía `silka_execute`
- **THEN** la operación completa dentro del umbral de 2 min en la máquina de referencia

### Requirement: NFR-PERF-02 Arranque del sandbox
The system SHALL iniciar el sandbox en menos de 300 ms en la máquina de referencia.

#### Scenario: Arranque medido
- **WHEN** se invoca la primera ejecución tras arranque frío
- **THEN** el tiempo hasta sandbox listo es < 300 ms

### Requirement: NFR-QUA-01 Calidad intacta (Code Mode)
The system SHALL mantener la tasa de verificaciones aprobadas sin empeorar frente a la línea base al usar Code Mode.

#### Scenario: Paridad de verify (T-ME-02)
- **WHEN** se compara la tasa de `verify` en línea base con y sin Code Mode
- **THEN** la tasa aprobada no baja frente a la línea base

### Requirement: SEC-01 Sandbox sin disco ni procesos
The system SHALL denegar permisos de sistema de archivos y procesos al sandbox (`--permission` sin `--allow-*`).

#### Scenario: Lectura de disco (T-SEC-01)
- **WHEN** el código intenta leer el disco
- **THEN** la ejecución falla con el error de política esperado

#### Scenario: Escritura en disco (T-SEC-02)
- **WHEN** el código intenta escribir en disco
- **THEN** la ejecución falla con el error de política esperado

#### Scenario: child_process (T-SEC-03)
- **WHEN** el código intenta lanzar un subproceso
- **THEN** la ejecución falla con el error de política esperado

### Requirement: SEC-02 Sin red en el sandbox
The system SHALL denegar módulos de red y ejecución mediante hook de resolución y eliminar globales de red.

#### Scenario: net y http (T-SEC-04)
- **WHEN** el código usa `net` o `http`
- **THEN** la ejecución falla con error de política

#### Scenario: fetch (T-SEC-05)
- **WHEN** el código usa `fetch`
- **THEN** la ejecución falla con error de política

#### Scenario: vm e inspector (T-SEC-06)
- **WHEN** el código carga `vm` o `inspector`
- **THEN** la ejecución falla con error de política

### Requirement: SEC-03 Límites por ejecución
The system SHALL aplicar límites de tiempo de pared (60 s por defecto, configurable hasta 60 min si solo espera IPC), heap 128 MB, 200 llamadas IPC y 1 MB de mensaje IPC.

#### Scenario: Heap y llamadas IPC (T-SEC-07)
- **WHEN** se excede el heap o el conteo de llamadas IPC
- **THEN** la ejecución termina con `E_LIMIT` indicando el límite alcanzado

### Requirement: SEC-04 Política por llamada IPC
The system SHALL validar cada llamada IPC con esquema y política del bridge (`allowedWorkspaces`, profundidad, lista blanca).

#### Scenario: Lote válido (T-CM-01)
- **WHEN** las llamadas IPC del programa respetan workspace y profundidad
- **THEN** el bridge las acepta y ejecuta

### Requirement: SEC-05 Referencias opacas
The system SHALL resolver en `silka.get(ref)` solo referencias emitidas por Silka; no acepta rutas arbitrarias.

#### Scenario: Salida grande (T-CM-03)
- **WHEN** se recupera una referencia `out:` emitida por Silka
- **THEN** el contenido completo se devuelve sin acceso a rutas del sistema