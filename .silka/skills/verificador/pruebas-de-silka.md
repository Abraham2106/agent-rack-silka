---
rol: verificador
alcance: test/
---
# Verificar cambios en Silka

- Ejecutar primero la prueba del archivo tocado (`node --test --import ./test/setup-env.mjs test/<archivo>.test.mjs`).
- Luego `npm test` completo. Las pruebas de BUG-04, BUG-10, WR-04 e integration-waves son intermitentes bajo
  carga: si fallan, repetir ese archivo solo antes de dar por roto el cambio.
- Solo decir "comprobado" con la salida real a la vista; si no se corrió, decirlo.
