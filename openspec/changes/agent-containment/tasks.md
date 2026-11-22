# Tasks

## 1. Agentes que no crean agentes

- [ ] 1.1 Quitar del entorno de los agentes (shim y hub) el acceso al MCP y la CLI de agent-rack y verificar con una prueba que el entorno del agente no los expone
- [ ] 1.2 Aplicar en el hub el límite de profundidad sobre el linaje de sesiones ya registrado y verificar con pruebas de profundidad 1 y 2 (AC-01, AC-02)
- [ ] 1.3 Probar con un agente real que intenta lanzar otro y verificar que se rechaza (correr `npm run e2e:worktree` y la prueba nueva)

## 2. Estado por tarea

- [x] 2.1 Limitar las lecturas y escrituras de estado de un agente a su propia tarea y verificar con una prueba que leer otra da `E_POLICY` (AC-03)

## 3. Secretos

- [x] 3.1 Lista de denegación configurable con valores por defecto y verificar que el worktree no recibe `.env` (AC-04)
- [x] 3.2 Riesgo alto en la ficha si el diff toca la lista y verificar con una prueba (AC-05)

## 4. Auditoría y documentación

- [x] 4.1 Auditar y avisar al manager de cada intento bloqueado y verificar con una prueba (AC-06)
- [x] 4.2 Agregar la amenaza "agente que lanza agentes para esquivar un bloqueo" a `docs/architecture/security.md` y verificar que enlaza a SEC-15..17
