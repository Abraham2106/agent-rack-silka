// Pantalla de carga del TUI, sin Ink: aparece al instante mientras se cargan Ink/React
// (~1–2 s en caliente en Windows, mucho más con la caché del disco fría) y se conecta el hub.
// El logo se revela de arriba abajo y la marca tiene un brillo que la recorre.
import { animOn, colorOn, logoRows, palette, shimmerSegments, SPINNER } from './theme.mjs';

const ESC = '\x1b[';
const rgb = (hex, bg = false) => {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return `${ESC}${bg ? 48 : 38};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};

function paintSegs(segs, color) {
  return segs.map((s) => {
    if (!color) return s.text;
    return (s.color ? rgb(s.color) : '') + (s.backgroundColor ? rgb(s.backgroundColor, true) : '') + s.text + `${ESC}0m`;
  }).join('');
}

const width = (segs) => segs.reduce((n, s) => n + [...s.text].length, 0);

export function startSplash({ out = process.stdout, env = process.env } = {}) {
  if (!out.isTTY) return { phase() {}, stop() {} };
  const color = colorOn(env);
  const anim = animOn(env);
  const fullscreen = env.SILKA_NO_FULLSCREEN !== '1';
  const cols = out.columns || 100;
  const rowsAvail = out.rows || 30;
  const logo = rowsAvail >= 26 ? logoRows(32, env) : [];
  let phase = 'arrancando';
  let frame = 0;
  let stopped = false;

  out.write(`${fullscreen ? `${ESC}?1049h` : ''}${ESC}?25l${ESC}2J`);

  function draw() {
    const shown = anim ? Math.min(logo.length, Math.ceil((frame + 1) * 1.5)) : logo.length;
    const lines = [];
    for (let i = 0; i < logo.length; i += 1) {
      const row = logo[i];
      lines.push({ text: i < shown ? paintSegs(row, color) : '', w: i < shown ? width(row) : 0 });
    }
    lines.push({ text: '', w: 0 });
    const mark = anim ? shimmerSegments('s i l k a', frame, palette.steelDim, palette.gem) : [{ text: 's i l k a', color: palette.gem }];
    lines.push({ text: paintSegs(mark.map((m) => ({ ...m })), color), w: 9 });
    const spin = anim ? SPINNER[frame % SPINNER.length] : '·';
    const status = `${spin} ${phase}…`;
    lines.push({ text: color ? `${rgb(palette.muted)}${status}${ESC}0m` : status, w: [...status].length });
    const top = Math.max(0, Math.floor((rowsAvail - lines.length) / 2));
    let buf = `${ESC}H`;
    for (let r = 0; r < top; r += 1) buf += `${ESC}2K\n`;
    for (const line of lines) {
      const pad = Math.max(0, Math.floor((cols - line.w) / 2));
      buf += `${ESC}2K${' '.repeat(pad)}${line.text}\n`;
    }
    out.write(buf);
    frame += 1;
  }

  draw();
  const timer = anim ? setInterval(draw, 70) : null;
  timer?.unref?.();

  return {
    phase(text) { phase = text; if (!anim && !stopped) draw(); },
    /** `handoff`: el TUI toma la pantalla (no se sale de la alternativa, sin parpadeo). */
    stop({ handoff = false } = {}) {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      out.write(`${ESC}2J${ESC}H${handoff ? '' : `${ESC}?25h${fullscreen ? `${ESC}?1049l` : ''}`}`);
    },
  };
}
