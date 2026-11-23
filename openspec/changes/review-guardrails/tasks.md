# Tasks

## 1. Entrada y revisor

- [x] 1.1 Módulo `src/silka/review/auto.mjs` que arma el encargo con solo diff y spec, y verificar con `node --test test/review-auto.test.mjs` (RG-01)
- [x] 1.2 Elegir un agente distinto del implementador (y el modelo del rol `revisar` si existe `routing`), y verificar con una prueba (RG-02)

## 2. Solo lectura

- [x] 2.1 Lanzar el revisor en solo lectura y comparar el estado del worktree antes y después, y verificar con una prueba con revisor falso que escribe (RG-03)

## 3. Hallazgos y riesgo

- [x] 3.1 Parsear hallazgos (severidad, archivo, motivo) como dato y guardarlos en la ficha, y verificar con una prueba (RG-04)
- [x] 3.2 Hallazgo grave sube el riesgo en `src/silka/tasks/risk.mjs`, y verificar con una prueba de riesgo (RG-05)
- [x] 3.3 Mostrar hallazgos en la bandeja y tolerar la falla del revisor, y verificar con una prueba de bandeja (RG-04, RG-06)
- [ ] 3.4 Ejecutar `npm test` y `npm run spec:validate`, y verificar que pasan

Verificación real: toca el ciclo de tareas; correr `npm run e2e:worktree` antes de decir "comprobado".
