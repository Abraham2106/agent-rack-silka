# Tasks

## 1. Modelo

- [x] 1.1 Extender el registro de decisiones con tipo, etiquetas y vigencia, compatible con las entradas actuales, y verificar con una prueba de lectura de entradas viejas (MEM-01)
- [x] 1.2 `silka memory add|ls` y `silka.memory.*` en Code Mode, y verificar con pruebas

## 2. Inyección

- [x] 2.1 Seleccionar entradas por alcance de la tarea con tope de 2 KB y referencia para el resto, y verificar con pruebas (MEM-02, MEM-03)
- [x] 2.2 Anteponerlas al encargo del agente y verificar con una tarea de prueba que el prompt las contiene

## 3. Aprendizajes y vigencia

- [x] 3.1 Propuesta de aprendizaje desde una ficha fallida, pendiente de confirmación, y verificar con una prueba (MEM-04)
- [x] 3.2 Marcar entradas como vencidas o reemplazadas y excluirlas de la inyección, y verificar con una prueba (MEM-05)
- [x] 3.3 Cargar como primeras entradas los aprendizajes ya conocidos (por ejemplo, soltar el enlace de `node_modules` antes de borrar un worktree) y verificar que se inyectan en una tarea que toca worktrees
