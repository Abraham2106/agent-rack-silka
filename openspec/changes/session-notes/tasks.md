# Tasks

## 1. Almacenamiento por sesión

- [x] 1.1 Archivo de notas por sesión en `src/silka/notes.mjs` y verificar con una prueba de escritura concurrente de dos sesiones (SN-01)
- [x] 1.2 Migración única del archivo global: repartir por sesión y descartar conflictos repetidos y sesiones inexistentes; verificar con una copia del archivo actual

## 2. Lectura

- [x] 2.1 `silka_notes` con tope de 20 y referencia al resto, y sin sesión solo conteos; verificar con pruebas (SN-02, SN-03)

## 3. Volatilidad

- [x] 3.1 Borrar al cerrar y leer, al cerrarse la tarea, y a las 24 h si la sesión desaparece; verificar con pruebas (SN-04, SN-05)

## 4. Conflictos como estado

- [x] 4.1 El detector de conflictos guarda estado sin repetir ni escribir notas, y verificar con diez ciclos seguidos (SN-06)
- [x] 4.2 El TUI muestra el ⚠ desde ese estado y verificar con una prueba de la vista
