# Tasks

## 1. Paridad antes de recortar

- [ ] 1.1 Listar las herramientas clásicas del bridge y su método equivalente en `silka.d.ts`; agregar los que falten y verificar con una prueba que cada herramienta tiene equivalente (BC-04)

## 2. Superficie mínima

- [ ] 2.1 El bridge expone solo `silka_search` y `silka_execute` por defecto y verificar con una prueba de listado (BC-01)
- [ ] 2.2 Error claro al llamar una herramienta clásica en modo por defecto, con la alternativa en Code Mode, y verificar con una prueba (BC-02)
- [ ] 2.3 Modo de compatibilidad `SILKA_BRIDGE_TOOLS=all` con el comportamiento anterior intacto, y verificar con la suite existente del bridge (BC-03)

## 3. Migración y medición

- [ ] 3.1 Actualizar la skill `delegar`, `silka connect` y la documentación para usar Code Mode, y verificar que los ejemplos corren
- [ ] 3.2 Medir el contexto fijo del bridge antes y después con `/context` en una sesión nueva y registrarlo en `docs/benchmarks/` (BC-05)
- [ ] 3.3 Probar con una sesión real de Claude Code que delegar con Code Mode sigue funcionando (correr también `npm run e2e:worktree`)
