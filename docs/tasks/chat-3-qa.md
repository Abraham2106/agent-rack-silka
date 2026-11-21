Rol: QA de la funcionalidad "chat con agentes y envío inmediato". NO corriges código. Verificas con pruebas reales y escribes un reporte.

Lee la especificación `docs/specs/chat-y-envio-inmediato.md`, sobre todo la sección 5 (criterios de aceptación), la 6 (los 11 riesgos con su mitigación) y la 7 (decisiones). El código es el HEAD de la rama `silka-roadmap`.

Qué verificar:
1. Cada criterio de aceptación de la sección 5, uno por uno: PASA o FALLA, con evidencia (comando y salida corta).
2. Cada uno de los 11 riesgos de la sección 6: ¿la mitigación está implementada y funciona? Marca MITIGADO, PARCIAL o NO, con evidencia. En especial:
   - paso a medias: el shim espera que termine la herramienta en curso, con tope de 10 s;
   - carreras: interrumpir justo cuando el turno termina solo; tú y "claude" enviando a la vez; nada se entrega dos veces;
   - dependencia de agent-rack: reanudar después de completed;
   - que reanudar funcione en los tres agentes;
   - costo en tokens: el chat muestra el contador de interrupciones;
   - instrucciones contradictorias: las inserciones están en `silka_notes` y `silka_state`, y el skill lo explica;
   - datos sensibles en el historial: redactado, fuera del repo;
   - rendimiento del TUI: al abrirlo hoy tarda unos 15 s en mostrar las sesiones. Mide el tiempo y encuentra la causa (archivo:línea).
3. Decisiones de la sección 7: Enter encola, Ctrl+Enter y Alt+Enter envían ya, y Claude puede usar `silka_send` con `now`. Un sub-agente NO debe poder usar `silka_send` sobre sesiones ajenas.
4. Seguridad del resume de Codex: el turno reanudado conserva el sandbox (`-c sandbox_mode=...`). Verifícalo con `read-only`: no debe poder escribir.
5. El TUI, de verdad. No tienes terminal interactiva, así que manéjalo con `node-pty` (ya está en node_modules como dependencia de agent-rack):
   - lánzalo en un pty de 120x35 y lee la salida;
   - verifica que entra y sale de la pantalla alternativa (`\x1b[?1049h` y `\x1b[?1049l`) y que el alto nunca pasa de las filas;
   - envía teclas: Enter, Alt+Enter (`\x1b\r`), Ctrl+Enter en formato kitty (`\x1b[13;5u`) y en modifyOtherKeys (`\x1b[27;5;13~`), ↑, Esc, `?`, `e`, Ctrl+B, PgUp/PgDn y `q`;
   - comprueba que cada una hace lo que dice la ayuda.

Reglas:
- No modifiques el repo, salvo tu reporte. Para pruebas usa `sandbox/` o una carpeta temporal.
- El hub del 8987 está vivo y TU sesión corre dentro de él. No lo apagues, no lo reinicies ni mates procesos node. Para interrupciones usa un hub de prueba en OTRO puerto (config temporal) y apágalo al terminar.
- No toques configs externas. Usa modelos rápidos (cursor `grok-4.7-medium-fast`, opencode por defecto).
- No dejes procesos vivos tuyos al terminar.
- `npm test`, `node --check` y `npm run smoke` deben pasar.

Entrega: `docs/reports/qa-chat.md` con:
- veredicto en 3 líneas;
- tabla de criterios;
- tabla de riesgos;
- hallazgos nuevos con severidad, archivo:línea y arreglo sugerido;
- "Top 5 para corregir".

Responde en 8 líneas o menos con el conteo (criterios X/Y, riesgos mitigados X/11) y lo más grave.
