Tarea: TUI de Silka, ronda de UI/UX. Dos frentes: (A) catálogo de modelos real por proveedor, (B) diseño visual, color y animación al nivel de Claude Code y Antigravity CLI.

Contexto: el TUI está en `src/silka/ui.mjs` + `src/silka/ui/` (Ink 8, alternate screen). Lee el código actual y `README.md` antes de cambiar nada.

## A. Catálogo de modelos (hoy el modelo se escribe a mano: eso es lo peor de la UX)

Fuentes reales (ya verificadas en esta máquina):
- Cursor: `cursor-agent --list-models`, líneas `id - Nombre`. Marca el `(default)` / `(current)`.
- OpenCode: `opencode models`, unas 400 líneas `proveedor/modelo`. Agrúpalas por proveedor y marca las gratuitas (`free` / `:free` en el id).
- Codex: no tiene comando de lista. Lee `~/.codex/models_cache.json` (`models[].slug`, `display_name`, `description`). OJO: ahí aparece `gpt-6.2-sol`, que NO funciona con una cuenta ChatGPT. Inspecciona los campos del cache por si alguno indica disponibilidad. Además, cuando una sesión falle con "model is not supported" / "no existe", guarda ese modelo como "no disponible con tu cuenta" y muéstralo así (atenuado, al final).

Entrega:
1. `src/silka/models.mjs`:
   - catálogo normalizado `{agent, id, name, provider, free, default, available, note}`;
   - caché en `~/.config/silka/models.json` con TTL de 6 h;
   - refresco en segundo plano que nunca bloquea el TUI;
   - tolera que un CLI falte o falle (devuelve lista vacía con el motivo).
2. `silka models [agente] [--refresh] [--json]`.
3. Selector de modelo en el TUI:
   - en el flujo `n`: agente → modelo → prompt;
   - búsqueda difusa mientras escribes y grupos por proveedor;
   - arriba: el modelo por defecto y los recientes;
   - marcas: ★ por defecto, gratis, ✗ no disponible;
   - flechas y Enter para elegir, Esc para volver;
   - un modelo escrito a mano que no esté en el catálogo pide confirmación.
4. Modelo por defecto por agente:
   - `silka models default <agente> <modelo>` escribe `agents.<x>.model` en `agent-rack.config.json`;
   - el selector también ofrece "usar como predeterminado".
5. Los modelos recientes se guardan en `~/.config/silka/recent-models.json`.

## B. Diseño visual (aplica estas reglas; no hagas "más bonito" genérico)

Referencias: el CLI de Antigravity (logo pixel art con degradado, una sola línea separadora, viñetas `●` de color para cada herramienta, "Thought for 2s, 852 tokens", "(ctrl+o to expand)") y las animaciones de Claude Code (spinner con verbos que rotan, tiempo transcurrido y tokens, texto con brillo en el estado activo).

Diagnóstico del TUI actual, lo que hay que romper:
- Todo son cajas con borde (`┌─┐` en lista, chat y entrada): cromo de dashboard sin jerarquía.
- Todo está a la misma intensidad, sin un punto focal.
- Casi sin color.
- Mismo tratamiento para autor, herramienta y estado.
- Sin animación.

Reglas:
1. **Una firma.** El logo de Silka, dos hachas cruzadas con un anillo (ver `docs/assets/logo.png`), en arte de bloques o pixel art (`▀▄█▌▐`), con degradado morado del logo (negro `#1C1B1F` → violeta `#5B2A9E` → `#8B5CF6`).
   - Va grande en la pantalla de inicio / estado vacío y en pequeño (2-3 líneas) en el encabezado, con "silka", la versión, el hub y el modelo, como Antigravity.
   - Es lo único ornamental; todo lo demás queda sobrio.
2. **Punto focal.** El chat del agente seleccionado es lo principal: queda a brillo completo. La lista de sesiones se atenúa (dim) salvo la fila seleccionada.
3. **Menos cajas.**
   - Quita los bordes de la lista y del chat. Sepáralos con una línea vertical fina o con espacio.
   - Usa UNA línea horizontal bajo el encabezado, como Antigravity.
   - La caja de entrada puede tener solo una línea superior y el prompt `›`.
4. **Ritmo.** Las herramientas van pegadas a su mensaje (sin línea vacía) y hay una línea vacía entre turnos. El ritmo es irregular a propósito.
5. **Roles distintos.**
   - Autor con color fijo por harness: claude coral `#D97757`, codex verde `#10A37F`, cursor azul `#3B82F6`, opencode ámbar `#F59E0B`, tú blanco en negrita.
   - Herramienta como en Antigravity: `●` de color según el estado (amarillo corriendo, verde ok, rojo error), el nombre en negrita del color del agente, los argumentos atenuados y "(enter para expandir)".
   - Razonamiento colapsado: `▸ Pensó 4s · 812 tokens` si el agente lo reporta.
   - Estado y metadatos en dim, nunca en el mismo color que el contenido.
6. **Movimiento orquestado.** Solo en el agente activo, abajo del chat, como Claude Code:
   - un spinner (`✻ ✶ ✳ ✢ ·` o braille) con un verbo que rota cada pocos segundos ("Forjando…", "Afilando…", "Tallando…": el tema son hachas y madera, no verbos genéricos), más el tiempo transcurrido y la herramienta actual;
   - un brillo (shimmer) que recorre el verbo.
   - Nada más se anima.
   - Tope de unos 10 fps.
   - `SILKA_NO_ANIM=1` o `NO_COLOR` lo apagan.
7. **Color con respaldo.** Truecolor si `COLORTERM=truecolor`, si no 256 colores y si no 16. Respeta `NO_COLOR`. Todo el color sale de un solo módulo de tema `src/silka/ui/theme.mjs`; nada de colores sueltos por el código.
8. **Texto con personalidad y específico.**
   - Estados vacíos como "Nada en el taller. `n` para poner a alguien a trabajar." en vez de "Sin sesiones".
   - Los errores dicen qué hacer.
   - Español consistente.
9. **No rompas nada.**
   - Alternate screen, alto exacto, scroll interno, Enter/Ctrl+Enter/Alt+Enter, ↑/Esc, `n` `c` `m` `e` `?` `q`, Ctrl+B y PgUp/PgDn siguen funcionando.
   - A 100 columnas y a 80 todo se ve bien: el logo grande se oculta si no cabe.

## Reglas de trabajo
- El hub del 8987 puede estar vivo y una sesión tuya corre dentro. No lo apagues, no lo reinicies ni mates procesos node.
- No toques configs externas salvo `agent-rack.config.json` desde `silka models default` (y solo en la prueba, devolviéndolo a como estaba).
- No dejes procesos vivos tuyos al terminar.
- Tests con `node:test`:
  - parseo de las tres fuentes (con fixtures), caché y TTL, marca de no disponible;
  - búsqueda difusa;
  - degradado y respaldo de color (truecolor, 256, 16, `NO_COLOR`);
  - que el layout no pase de las filas a 80x24 y 120x35.
  `npm test` debe pasar completo.
- Verifica el TUI con `node-pty` (está en node_modules), quitando la variable `CI`:
  - captura pantallas en texto a 120x35 y 80x24;
  - recorre el flujo `n` → agente → modelo (con búsqueda) → prompt;
  - guarda 2 o 3 capturas en `docs/assets/tui-*.txt` para revisión.

Al terminar responde en 10 líneas o menos: archivos, cuántos modelos ve cada agente, qué probaste y qué no quedó.
