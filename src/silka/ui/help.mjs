export function helpLines() {
  return [
    '↑↓        elegir sesión (↑ edita el último en cola si hay uno)',
    'enter     encola el mensaje; sobre una herramienta, la abre',
    'esc       borra el último en cola, o lo que estás editando',
    'ctrl+b    oculta la lista y deja el chat a pantalla completa',
    '/         busca en el chat',
    'pgup/dn   sube o baja en el chat (deja de seguir el final)',
    'n         nueva sesión: agente, modelo opcional, prompt',
    '          en el prompt, enter es otra línea y Ctrl+S envía',
    'i         redirigir: cancela y sigue con una instrucción nueva',
    'm         nota para el manager (silka_notes)',
    'e         estado del workspace: rama, tareas, conflictos, decisiones',
    'c         cancelar, pide confirmación',
    '?         esta ayuda',
    'q         salir',
    'Q en la lista: hay mensajes en cola.  N: hay notas sin leer.  !: conflicto de archivos.',
    '↳ une la sesión nueva con la que redirigiste, o una hija bajo quien la lanzó.',
    'El origen (tú, claude-code, codex…) dice quién abrió la sesión.',
    'Alt+Enter será enviar ya. En esta parte Enter solo encola.',
  ];
}

export function renderHelp(h, Box, Text, { height, columns, lines }) {
  const shown = (lines || helpLines()).slice(0, Math.max(1, height - 3));
  return h(
    Box,
    { flexGrow: 1, height, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
    h(Text, { bold: true }, 'Ayuda'),
    ...shown.map((line) => h(Text, { key: line, wrap: 'truncate' }, line.length > columns - 4 ? `${line.slice(0, columns - 5)}…` : line)),
  );
}
