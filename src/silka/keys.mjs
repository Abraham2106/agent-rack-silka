/** Ctrl+Enter y Alt+Enter, en kitty (CSI u) y en modifyOtherKeys. */

const HOLD_RE = /^\u001b(?:$|\[[\d;<]*$|\[<[\d;]*$)/;

export function parseChord(sequence) {
  const s = String(sequence ?? '');
  let match = /^\u001b\[(\d+)(?::\d+)?(?:;(\d+))?u$/.exec(s);
  if (match) {
    const code = Number(match[1]);
    const mods = match[2] ? Math.max(0, Number(match[2]) - 1) : 0;
    return {
      return: code === 13 || code === 57414,
      ctrl: Boolean(mods & 4),
      meta: Boolean(mods & 2),
      shift: Boolean(mods & 1),
    };
  }
  match = /^\u001b\[27;(\d+);(\d+)~$/.exec(s);
  if (match) {
    const mods = Math.max(0, Number(match[1]) - 1);
    const key = Number(match[2]);
    return {
      return: key === 13 || key === 10,
      ctrl: Boolean(mods & 4),
      meta: Boolean(mods & 2),
      shift: Boolean(mods & 1),
    };
  }
  if (s === '\u001b\r' || s === '\u001b\n') return { return: true, ctrl: false, meta: true, shift: false };
  if (s === '\r' || s === '\n') return { return: true, ctrl: false, meta: false, shift: false };
  return null;
}

/** `now` envía ya. `queue` es Enter a secas. */
export function chordAction(sequence) {
  const key = parseChord(sequence);
  if (!key?.return) return null;
  if (key.ctrl || key.meta) return 'now';
  return 'queue';
}

export function isSendNowKey(_input, key) {
  return Boolean(key?.return && (key.ctrl || key.meta));
}

/**
 * Traduce modifyOtherKeys y la rueda (SGR) a secuencias que Ink ya entiende
 * (CSI u y PgUp/PgDn). El resto de los CSI pasa igual, incluida la respuesta kitty.
 */
export function translateInputChunk(text, held = '') {
  let raw = `${held}${text}`;
  let out = '';
  while (raw.length) {
    if (raw[0] !== '\u001b') {
      const next = raw.indexOf('\u001b');
      if (next < 0) {
        out += raw;
        raw = '';
        break;
      }
      out += raw.slice(0, next);
      raw = raw.slice(next);
      continue;
    }
    const mouse = /^\u001b\[<(\d+);\d+;\d+[mM]/.exec(raw);
    if (mouse) {
      const button = Number(mouse[1]) & 0b1100011;
      if (button === 64) out += '\u001b[5~';
      else if (button === 65) out += '\u001b[6~';
      raw = raw.slice(mouse[0].length);
      continue;
    }
    const other = /^\u001b\[27;(\d+);(\d+)~/.exec(raw);
    if (other) {
      out += `\u001b[${other[2]};${other[1]}u`;
      raw = raw.slice(other[0].length);
      continue;
    }
    const csi = /^\u001b\[[\x20-\x3f]*[\x20-\x2f]*[\x40-\x7e]/.exec(raw);
    if (csi) {
      out += csi[0];
      raw = raw.slice(csi[0].length);
      continue;
    }
    if (HOLD_RE.test(raw) && raw.length < 64) break;
    out += raw[0];
    raw = raw.slice(1);
  }
  return { out, held: raw };
}

export const MODIFY_OTHER_KEYS_ON = '\u001b[>4;2m';
export const MODIFY_OTHER_KEYS_OFF = '\u001b[>4;0m';
export const MOUSE_ON = '\u001b[?1000h\u001b[?1006h';
export const MOUSE_OFF = '\u001b[?1006l\u001b[?1000l';

/** La rueda y Ctrl+Enter llegan como PgUp/PgDn y CSI u antes de que Ink los lea. */
export function installInputFix(stdin) {
  if (!stdin || typeof stdin.read !== 'function' || stdin.__silkaInput) return () => {};
  const orig = stdin.read.bind(stdin);
  let held = '';
  let flush = '';
  let timer = null;
  // Un Esc solo queda retenido esperando ver si empieza una secuencia (\x1b[…). Si en 40 ms
  // no llega nada más, era la tecla Esc: la soltamos para que Ink la vea.
  const armFlush = () => {
    clearTimeout(timer);
    if (!held) return;
    timer = setTimeout(() => {
      if (!held) return;
      flush = held;
      held = '';
      stdin.emit('readable');
    }, 40);
    timer.unref?.();
  };
  stdin.read = function silkaRead(size) {
    if (flush) {
      const out = flush;
      flush = '';
      return out;
    }
    let produced = '';
    for (;;) {
      const chunk = orig(size);
      if (chunk == null) break;
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const translated = translateInputChunk(text, held);
      held = translated.held;
      produced += translated.out;
      if (produced) break;
    }
    armFlush();
    return produced || null;
  };
  stdin.__silkaInput = true;
  return () => {
    try { stdin.read = orig; } catch { /* el stdin ya se cerró */ }
    delete stdin.__silkaInput;
  };
}
