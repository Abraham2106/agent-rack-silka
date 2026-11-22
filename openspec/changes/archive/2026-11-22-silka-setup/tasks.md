# Tasks

## 1. Detección

- [x] 1.1 Extraer de `src/silka/doctor/checks.mjs` la detección de agentes a un módulo compartido sin cambiar la salida de doctor, y verificar con `node --test test/doctor.test.mjs`
- [x] 1.2 Módulo `src/silka/setup/` que usa esa detección, y verificar con un PATH de prueba sin cursor (ST-01)

## 2. Plan y diff

- [x] 2.1 Calcular los archivos y contenidos a escribir (config efectiva y bridge) y su diff contra lo existente, y verificar con una prueba de diff sobre una carpeta temporal
- [x] 2.2 Subcomando `silka setup` en dry-run por defecto, y verificar que ningún archivo cambia (ST-02)

## 3. Aplicar

- [x] 3.1 `--apply` escribe con `writeAtomic` solo bajo la carpeta de config de Silka, y verificar con una prueba que la config global simulada queda intacta (ST-03)
- [x] 3.2 Idempotencia y `--json`, y verificar con una prueba de doble ejecución y otra de salida JSON (ST-04, ST-05)
- [x] 3.3 Ejecutar `npm test` y `npm run spec:validate`, y verificar que pasan

Verificación real: toca config del hub; correr `npm run e2e:worktree` antes de decir "comprobado".
