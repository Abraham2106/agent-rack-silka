/** SEC-09: el texto del agente se muestra como dato, sin secuencias de terminal. */
export function escapeAgentText(text) {
  let s = String(text ?? '');
  // OSC … BEL o ST
  s = s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  s = s.replace(/\x9b\][^\x07\x9b]*(?:\x07|\x9b\\)/g, '');
  // CSI / ESC
  s = s.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  s = s.replace(/\x9b[0-?]*[ -/]*[@-~]/g, '');
  // C0 de control salvo tab y newline
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return s;
}