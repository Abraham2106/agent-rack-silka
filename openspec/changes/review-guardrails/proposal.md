# Proposal

## Why

La ficha llega a la bandeja con riesgo calculado por reglas (`src/silka/tasks/risk.mjs`: verify, alcance, rutas
sensibles, tamaño), pero nadie lee el diff con ojos de revisor antes de que lo vea el humano. Un revisor
automático independiente, acotado y sin permiso de escritura, filtra problemas obvios y deja al humano decidir
con más información, sin sustituirlo.

## What Changes

- Paso opcional de revisión automática entre la verificación y la bandeja: una sesión de un agente distinto del
  implementador lee solo el diff y la spec de la tarea.
- Emite hallazgos con severidad (`info`, `media`, `grave`), archivo y motivo, guardados en la ficha.
- El revisor no puede escribir en el worktree: se lanza solo lectura y Silka comprueba que el worktree no cambió.
- Un hallazgo `grave` sube el riesgo de la ficha a alto (vía `risk.mjs`); la decisión sigue siendo del humano.
- Si existe `model-routing`, el modelo del revisor sale del rol `revisar`; si no, un defecto.

**Fuera de alcance:** aprobar o rechazar solo; corregir el código; revisar commits ya mezclados; repetir la
revisión en bucle; sustituir los gates de verify.

## Dependencias

Opcionales: `model-routing` (modelo del rol `revisar`) y `role-skills` (skills del rol `revisor`); funciona sin
ninguna. Reutiliza `risk.mjs` y la bandeja de revisión existentes. Ninguna dependencia circular: los otros
cambios no dependen de este.

## Capabilities

### New Capabilities

- `review-guardrails`: revisión automática acotada y de solo lectura que genera hallazgos con severidad y puede
  subir el riesgo de la ficha.

### Modified Capabilities

(ninguna)

## Impact

- Módulo nuevo `src/silka/review/auto.mjs`, ajustes en `src/silka/tasks/risk.mjs` y `src/silka/tasks/card.mjs`
  (campo de hallazgos y riesgo) y en la bandeja (`src/silka/review/inbox.mjs`) para mostrarlos.
- Un costo extra de sesión por tarea cuando está activado; se activa por configuración.
