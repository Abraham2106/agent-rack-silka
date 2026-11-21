# ADR-0004: Sandbox de Code Mode con proceso Node aislado y el permission model

- Estado: Aceptada
- Fecha: 2026-11-21
- Relacionadas: ADR-0003, ADR-0009; [security.md](../architecture/security.md)

## Contexto
`silka_execute` corre código escrito por un modelo. Ese código puede ser erróneo, o malicioso si el manager recibió una inyección de prompt. Debe poder llamar la API `silka` y nada más: ni disco, ni procesos, ni red, ni consumo ilimitado.

## Decisión
- Cada ejecución corre en un **proceso Node hijo efímero** con `--permission`, sin permisos de sistema de archivos ni de procesos hijos. Verificado en Node 22.22 de la máquina de referencia: leer, escribir y lanzar procesos devuelven `ERR_ACCESS_DENIED`.
- Como el permission model de Node 22 **no restringe la red**:
  - un hook de resolución de módulos rechaza `net`, `http`, `https`, `http2`, `tls`, `dgram`, `dns`, `child_process`, `worker_threads`, `cluster`, `vm`, `inspector` y `module`;
  - se eliminan `fetch`, `WebSocket`, `EventSource` y `process.binding` antes de cargar el código.
- La única salida es un canal IPC con el bridge, que expone la API `silka` con validación de argumentos y aplica la política del bridge (defensa en profundidad).
- Límites:
  - tiempo de pared por ejecución;
  - heap (`--max-old-space-size`);
  - número de llamadas IPC por ejecución;
  - tamaño de la respuesta. Lo que excede la respuesta se guarda y se devuelve por referencia, sin truncar (ADR-0002).

## Alternativas evaluadas
| Opción | Por qué no (por ahora) |
|---|---|
| Módulo `vm` de Node | La documentación de Node dice explícitamente que no es un mecanismo de seguridad |
| `isolated-vm` | Aislamiento V8 fuerte, pero es una dependencia nativa con compilación en Windows (ADR-0009) |
| Deno con `--deny-*` | Sandbox maduro, pero añade otro runtime al install |
| Contenedor (Docker) | Aislamiento fuerte, pero es pesado y no siempre está disponible en Windows |
| Cloudflare Workers / workerd | Diseñado para esto, pero es un runtime adicional |

## Consecuencias
- (+) Cero dependencias nuevas; funciona en Windows, macOS y Linux.
- (−) La red se bloquea por lista de denegación, no por el runtime. Se exigen **pruebas negativas** por cada vía (T-SEC-01…07) y se revisa al subir de versión de Node.
- (−) El permission model es reciente. Si aparece una fuga, la alternativa preparada es `isolated-vm` o Deno detrás de la misma interfaz (`SandboxRunner`).
- Revisar cuando Node incluya restricciones de red en el permission model. En ese momento se reemplaza la lista de denegación.
