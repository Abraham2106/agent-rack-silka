import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { redirectSession } from './commands.mjs';
import { activityFromEvents, clip, formatDuration, isBusy, promptPreview, shortId, statusColor, statusIcon } from './format.mjs';
import { readMeta, rememberSession } from './hub.mjs';
import { appendNote, unreadSessionIds } from './notes.mjs';

const h = React.createElement;

function snapshotQueues(queues) {
  const out = {};
  for (const [id, items] of Object.entries(queues)) {
    if (items?.length) out[id] = [...items];
  }
  return out;
}

function wrapBlock(text, width, maxLines) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || maxLines <= 0 || width <= 0) return [];
  const lines = [];
  let rest = clean;
  while (rest && lines.length < maxLines) {
    if (rest.length <= width) {
      lines.push(rest);
      rest = '';
      break;
    }
    let cut = rest.lastIndexOf(' ', width);
    if (cut < Math.floor(width * 0.4)) cut = width;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest && lines.length) lines[lines.length - 1] = clip(`${lines[lines.length - 1]}…`, width);
  return lines;
}

export function App({ client, port, agents, models = {} }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = Math.max(16, stdout?.rows ?? 24);
  const columns = Math.max(60, stdout?.columns ?? 100);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [log, setLog] = useState({ id: null, lines: [] });
  const [draft, setDraft] = useState('');
  const [field, setField] = useState('');
  const [queues, setQueues] = useState({});
  const [banner, setBanner] = useState(null);
  const [meta, setMeta] = useState(() => readMeta(port));
  const [noted, setNoted] = useState(() => unreadSessionIds());
  const [hubOk, setHubOk] = useState(true);
  const [mode, setMode] = useState('main');
  const [wizard, setWizard] = useState(null);

  const sessionsRef = useRef([]);
  const selectedIdRef = useRef(null);
  const draftRef = useRef('');
  const fieldRef = useRef('');
  const queuesRef = useRef({});
  const inflightRef = useRef({});
  const wizardRef = useRef(null);
  const modeRef = useRef('main');

  sessionsRef.current = sessions;
  selectedIdRef.current = selectedId;
  draftRef.current = draft;
  fieldRef.current = field;
  wizardRef.current = wizard;
  modeRef.current = mode;

  function publishQueues() {
    setQueues(snapshotQueues(queuesRef.current));
  }

  function enqueue(id, message) {
    if (!queuesRef.current[id]) queuesRef.current[id] = [];
    queuesRef.current[id].push(message);
    publishQueues();
  }

  function fail(err) {
    setBanner({ text: err instanceof Error ? err.message : String(err), color: 'red' });
  }

  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(sessions[0].sessionId);
    else if (selectedId && sessions.length && !sessions.some((session) => session.sessionId === selectedId)) {
      setSelectedId(sessions[0].sessionId);
    }
  }, [sessions, selectedId]);

  useEffect(() => {
    let cancel = false;
    let running = false;

    async function tick() {
      if (running || cancel) return;
      running = true;
      try {
        const list = await client.listSessions();
        if (cancel) return;
        const sessionsNow = Array.isArray(list) ? list : [];
        setSessions(sessionsNow);
        setMeta(readMeta(port));
        setNoted(unreadSessionIds());
        setHubOk(true);

        for (const session of sessionsNow) {
          const id = session.sessionId;
          const flight = inflightRef.current[id];
          const busy = isBusy(session.status);
          if (flight) {
            if (busy || (session.turnCount ?? 0) > flight.turn) flight.seen = true;
            if ((flight.seen && !busy) || (!flight.seen && Date.now() - flight.at > 8000)) {
              delete inflightRef.current[id];
            }
          }
          const queued = queuesRef.current[id];
          if (!queued?.length || inflightRef.current[id] || busy) continue;
          const message = queued[0];
          try {
            await client.sendInput(id, message);
            if (queued[0] === message) queued.shift();
            inflightRef.current[id] = { turn: session.turnCount ?? 0, seen: false, at: Date.now() };
            if (!cancel) publishQueues();
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            if (/is still (running|cancelling)|still running/i.test(detail)) continue;
            if (!cancel) fail(err);
          }
        }

        const currentId = selectedIdRef.current;
        const current = sessionsNow.find((session) => session.sessionId === currentId) ?? sessionsNow[0];
        if (!current) {
          if (!cancel) setLog({ id: null, lines: [] });
          return;
        }
        const page = await client.getSessionLogTail(current.sessionId, 80);
        if (cancel || selectedIdRef.current !== current.sessionId && selectedIdRef.current) return;
        const events = Array.isArray(page?.events) ? page.events : [];
        setLog({ id: current.sessionId, lines: activityFromEvents(events) });
      } catch (err) {
        if (!cancel) {
          setHubOk(false);
          fail(err);
        }
      } finally {
        running = false;
      }
    }

    tick();
    const timer = setInterval(tick, 1500);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [client, port]);

  async function submitDraft() {
    const id = selectedIdRef.current;
    const text = draftRef.current.trim();
    if (!id) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    if (!text) return;
    setDraft('');
    const session = sessionsRef.current.find((item) => item.sessionId === id);
    if (session && isBusy(session.status)) {
      enqueue(id, text);
      setBanner({ text: 'En cola: se envía al terminar el turno.', color: 'yellow' });
      return;
    }
    try {
      await client.sendInput(id, text);
      inflightRef.current[id] = { turn: session?.turnCount ?? 0, seen: false, at: Date.now() };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/is still (running|cancelling)|still running/i.test(detail)) {
        enqueue(id, text);
        setBanner({ text: 'En cola: se envía al terminar el turno.', color: 'yellow' });
      } else fail(err);
    }
  }

  async function cancelSelected() {
    const id = selectedIdRef.current;
    if (!id) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    try {
      await client.cancelSession(id);
      if (queuesRef.current[id]) {
        queuesRef.current[id] = [];
        publishQueues();
      }
      setBanner({ text: `Cancelando ${shortId(id)}.`, color: 'yellow' });
    } catch (err) {
      fail(err);
    }
  }

  async function createFromWizard() {
    const current = wizardRef.current;
    if (!current?.agent || !current.prompt.trim()) {
      setBanner({ text: 'La sesión nueva necesita agente y prompt.', color: 'red' });
      return;
    }
    try {
      const model = current.model.trim();
      const prompt = current.prompt.trim();
      const created = await client.createSession(current.agent, prompt, process.cwd(), model || undefined);
      const sessionId = created?.sessionId;
      if (!sessionId) throw new Error('El hub no devolvió un sessionId.');
      rememberSession(port, sessionId, { prompt, model });
      setMeta(readMeta(port));
      setSelectedId(sessionId);
      setWizard(null);
      setBanner({ text: `Sesión ${shortId(sessionId)} creada.`, color: 'green' });
    } catch (err) {
      fail(err);
    }
  }

  async function submitField() {
    const text = fieldRef.current.trim();
    const id = selectedIdRef.current;
    const which = modeRef.current;
    if (!id) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    if (!text) return;
    const session = sessionsRef.current.find((item) => item.sessionId === id);
    setField('');
    setMode('main');
    if (!session) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    try {
      if (which === 'note') {
        appendNote({ sessionId: session.sessionId, text });
        setNoted(unreadSessionIds());
        setBanner({ text: 'Nota guardada para el manager.', color: 'green' });
        return;
      }
      const status = {
        port,
        config: { agents: Object.fromEntries(Object.entries(models).map(([agent, model]) => [agent, { model }])) },
      };
      const createdId = await redirectSession(client, status, session, text);
      setMeta(readMeta(port));
      setSelectedId(createdId);
      setBanner({ text: `Redirigida ${shortId(session.sessionId)} → ${shortId(createdId)}.`, color: 'green' });
    } catch (err) {
      fail(err);
    }
  }

  useInput((input, key) => {
    const currentMode = modeRef.current;
    const currentWizard = wizardRef.current;

    if (currentMode === 'help') {
      if (key.escape || input === '?' || input === 'q') setMode('main');
      return;
    }
    if (currentMode === 'confirm') {
      if (input === 's' || input === 'S' || input === 'y' || input === 'Y') void cancelSelected();
      setMode('main');
      return;
    }
    if (currentMode === 'steer' || currentMode === 'note') {
      if (key.escape) {
        setMode('main');
        setField('');
        return;
      }
      if (key.return) {
        void submitField();
        return;
      }
      if (key.backspace || key.delete) {
        setField((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setField((value) => value + input);
      return;
    }

    if (currentWizard?.step === 'agent') {
      if (key.escape) {
        setWizard(null);
        return;
      }
      if (key.upArrow) {
        setWizard({ ...currentWizard, index: Math.max(0, currentWizard.index - 1) });
        return;
      }
      if (key.downArrow) {
        setWizard({ ...currentWizard, index: Math.min(agents.length - 1, currentWizard.index + 1) });
        return;
      }
      if (key.return && agents.length) {
        setWizard({ ...currentWizard, step: 'model', agent: agents[currentWizard.index] });
      }
      return;
    }
    if (currentWizard && (currentWizard.step === 'model' || currentWizard.step === 'prompt')) {
      if (key.escape) {
        setWizard(currentWizard.step === 'prompt'
          ? { ...currentWizard, step: 'model' }
          : { ...currentWizard, step: 'agent' });
        return;
      }
      const sendPrompt = currentWizard.step === 'prompt' && key.ctrl && (key.return || input === 's' || input === 'S' || input === '\u0013');
      if (sendPrompt) {
        void createFromWizard();
        return;
      }
      if (key.return) {
        if (currentWizard.step === 'model') setWizard({ ...currentWizard, step: 'prompt' });
        else setWizard({ ...currentWizard, prompt: `${currentWizard.prompt}\n` });
        return;
      }
      if (key.backspace || key.delete) {
        const name = currentWizard.step;
        setWizard({ ...currentWizard, [name]: currentWizard[name].slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const name = currentWizard.step;
        setWizard({ ...currentWizard, [name]: currentWizard[name] + input.replaceAll('\r', '') });
      }
      return;
    }

    if (banner) setBanner(null);
    const list = sessionsRef.current;
    if (key.upArrow || key.downArrow) {
      if (!list.length) return;
      let index = list.findIndex((session) => session.sessionId === selectedIdRef.current);
      if (index < 0) index = 0;
      const delta = key.upArrow ? -1 : 1;
      const next = list[Math.min(list.length - 1, Math.max(0, index + delta))];
      setSelectedId(next.sessionId);
      return;
    }
    if (key.return) {
      void submitDraft();
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((value) => value.slice(0, -1));
      return;
    }
    if (input === '?' && draftRef.current === '' && !key.ctrl) {
      setMode('help');
      return;
    }
    if (input === 'q' && draftRef.current === '' && !key.ctrl) {
      exit();
      return;
    }
    if (input === 'c' && draftRef.current === '' && !key.ctrl) {
      if (!selectedIdRef.current) {
        setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
        return;
      }
      setMode('confirm');
      return;
    }
    if (input === 'i' && draftRef.current === '' && !key.ctrl) {
      if (!selectedIdRef.current) {
        setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
        return;
      }
      setField('');
      setMode('steer');
      return;
    }
    if (input === 'm' && draftRef.current === '' && !key.ctrl) {
      if (!selectedIdRef.current) {
        setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
        return;
      }
      setField('');
      setMode('note');
      return;
    }
    if (input === 'n' && draftRef.current === '' && !key.ctrl) {
      if (!agents.length) {
        setBanner({ text: 'No hay agentes en agent-rack.config.json.', color: 'red' });
        return;
      }
      setWizard({ step: 'agent', index: 0, agent: agents[0], model: '', prompt: '' });
      return;
    }
    if (input && !key.ctrl && !key.meta) setDraft((value) => value + input);
  });

  const selected = sessions.find((session) => session.sessionId === selectedId) ?? sessions[0] ?? null;
  const leftWidth = Math.max(28, Math.min(40, Math.floor(columns * 0.38)));
  const rightWidth = Math.max(20, columns - leftWidth);
  const innerLeft = Math.max(8, leftWidth - 4);
  const innerRight = Math.max(8, rightWidth - 4);
  const selectedMeta = selected ? meta[selected.sessionId] : null;
  const queued = selected ? queues[selected.sessionId] ?? [] : [];
  const activity = log.id && selected && log.id === selected.sessionId ? log.lines : [];
  const summaryText = selected && !isBusy(selected.status) ? String(selected.summary || '').trim() : '';

  let composerInner = 1;
  if (wizard?.step === 'agent') composerInner = 1 + Math.max(agents.length, 1);
  else if (wizard?.step === 'model' || mode === 'confirm') composerInner = 2;
  else if (wizard?.step === 'prompt') composerInner = 4;
  else if (mode === 'steer' || mode === 'note') composerInner = 2;
  const composerH = Math.min(composerInner + 2, Math.max(3, rows - 8));
  const bodyH = Math.max(1, rows - composerH - 3);
  const listRoom = Math.max(1, bodyH - 3);
  const visibleCount = Math.max(1, Math.floor(listRoom / 2));
  let selectedIndex = sessions.findIndex((session) => session.sessionId === selected?.sessionId);
  if (selectedIndex < 0) selectedIndex = 0;
  let windowStart = 0;
  if (sessions.length > visibleCount) {
    windowStart = Math.min(Math.max(0, selectedIndex - Math.floor(visibleCount / 2)), sessions.length - visibleCount);
  }
  const visibleSessions = sessions.slice(windowStart, windowStart + visibleCount);

  const rightInner = Math.max(1, bodyH - 2);
  const summaryBudget = summaryText ? Math.min(5, Math.max(2, Math.floor(rightInner / 3))) : 0;
  const queueBudget = queued.length ? Math.min(3, 1 + queued.length) : 0;
  const activityBudget = Math.max(1, rightInner - 3 - queueBudget - summaryBudget);
  const visibleActivity = activity.slice(-activityBudget).map((line) => clip(line, innerRight));
  const summaryLines = wrapBlock(summaryText, innerRight, Math.max(0, summaryBudget - 1));

  const sessionLabel = `${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}`;

  const sessionRows = visibleSessions.map((session) => {
    const active = selected?.sessionId === session.sessionId;
    const info = meta[session.sessionId] || {};
    const model = info.model || models[session.agentId] || '';
    const marks = `${queues[session.sessionId]?.length ? 'Q' : ''}${noted.has(session.sessionId) ? 'N' : ''}`;
    const head = clip(
      `${statusIcon(session.status)} ${shortId(session.sessionId)} ${session.agentId} ${formatDuration(session)}${marks ? ` ${marks}` : ''}`,
      innerLeft,
    );
    const sub = info.steeredFrom
      ? clip(`↳ ${shortId(info.steeredFrom)} · ${promptPreview(info.prompt || session.summary || '') || 'sigue el trabajo'}`, innerLeft)
      : clip([model, promptPreview(info.prompt || session.summary || '')].filter(Boolean).join(' · ') || 'sin prompt', innerLeft);
    return h(
      Box,
      { key: session.sessionId, flexDirection: 'column' },
      h(Text, { inverse: active, color: active ? undefined : statusColor(session.status), wrap: 'truncate' }, head),
      h(Text, { inverse: active, dimColor: !active, wrap: 'truncate' }, sub),
    );
  });

  let composer;
  if (mode === 'help') {
    composer = h(Text, { wrap: 'truncate' }, 'Ayuda abierta. esc cierra.');
  } else if (mode === 'confirm') {
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { color: 'yellow' }, `Cancelar ${selected ? shortId(selected.sessionId) : ''}?`),
      h(Text, { dimColor: true, wrap: 'truncate' }, 's confirma · cualquier otra tecla vuelve'),
    );
  } else if (mode === 'steer' || mode === 'note') {
    const label = mode === 'steer' ? 'Redirigir' : 'Nota para el manager';
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `${label} · enter guarda · esc cancela`),
      h(Text, { wrap: 'truncate' }, clip(`${field}█`, columns - 4)),
    );
  } else if (wizard?.step === 'agent') {
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { bold: true }, 'Nueva sesión · elige agente'),
      ...agents.map((agent, index) => h(
        Text,
        { key: agent, inverse: index === wizard.index, wrap: 'truncate' },
        index === wizard.index ? `▸ ${agent}` : `  ${agent}`,
      )),
    );
  } else if (wizard?.step === 'model') {
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `Modelo para ${wizard.agent} · enter lo deja vacío · esc vuelve`),
      h(Text, { wrap: 'truncate' }, `${wizard.model}█`),
    );
  } else if (wizard?.step === 'prompt') {
    const promptLines = (wizard.prompt || ' ').split('\n');
    const shown = promptLines.slice(-Math.max(1, composerH - 3));
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { dimColor: true, wrap: 'truncate' }, `Prompt de ${wizard.agent} · enter línea · Ctrl+S envía · esc vuelve`),
      ...shown.map((line, index) => h(Text, { key: `${index}:${line}`, wrap: 'truncate' }, clip(index === shown.length - 1 ? `${line}█` : line, columns - 4))),
    );
  } else {
    composer = h(Text, { wrap: 'truncate' }, clip(`› ${draft}█`, columns - 4));
  }

  const helpRows = [
    '↑↓        elegir sesión',
    'enter     enviar mensaje (si sigue en curso, queda en cola)',
    'n         nueva sesión: agente, modelo opcional, prompt',
    '          en el prompt, enter es otra línea y Ctrl+S envía',
    'i         redirigir: cancela y sigue con una instrucción nueva',
    'm         nota para el manager (silka_notes)',
    'c         cancelar, pide confirmación',
    '?         esta ayuda',
    'q         salir',
    'Q en la lista: hay mensajes en cola.  N: hay notas sin leer.',
    '↳ une la sesión nueva con la que redirigiste.',
  ];

  const panels = mode === 'help'
    ? h(
      Box,
      { flexGrow: 1, height: bodyH, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
      h(Text, { bold: true }, 'Ayuda'),
      ...helpRows.slice(0, Math.max(1, bodyH - 3)).map((line) => h(Text, { key: line, wrap: 'truncate' }, clip(line, columns - 4))),
    )
    : h(
      Box,
      { flexGrow: 1, height: bodyH, overflow: 'hidden' },
      h(
        Box,
        { width: leftWidth, height: bodyH, flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1, overflow: 'hidden' },
        h(Text, { bold: true }, sessions.length > visibleCount ? `Sesiones ${windowStart + 1}-${windowStart + visibleSessions.length}/${sessions.length}` : 'Sesiones'),
        sessions.length ? sessionRows : h(Text, { dimColor: true }, 'Sin sesiones. n crea una.'),
      ),
      h(
        Box,
        { width: rightWidth, height: bodyH, flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1, overflow: 'hidden' },
        selected
          ? h(
            Text,
            { bold: true, wrap: 'truncate' },
            `${statusIcon(selected.status)} ${selected.agentId} `,
            h(Text, { color: statusColor(selected.status) }, selected.status),
            `  ${shortId(selected.sessionId)}`,
          )
          : h(Text, { bold: true }, 'Actividad'),
        h(Text, { dimColor: true, wrap: 'truncate' }, selectedMeta?.steeredFrom ? `viene de ${shortId(selectedMeta.steeredFrom)}` : ' '),
        h(
          Text,
          { dimColor: true, wrap: 'truncate' },
          clip(selected ? (selectedMeta?.prompt || selected.summary || selected.workspace || '') : '', innerRight) || ' ',
        ),
        visibleActivity.length
          ? visibleActivity.map((line, index) => h(Text, { key: `${activity.length - visibleActivity.length + index}:${line}`, wrap: 'truncate' }, line || ' '))
          : h(Text, { dimColor: true }, selected ? 'Sin actividad todavía.' : 'Elige o crea una sesión.'),
        queueBudget
          ? h(Text, { color: 'yellow', wrap: 'truncate' }, clip(`en cola  ${queued.map((message, index) => `${index + 1}. ${message}`).join('  ')}`, innerRight))
          : null,
        summaryBudget
          ? h(Text, { dimColor: true }, 'resumen')
          : null,
        ...summaryLines.map((line, index) => h(Text, { key: `sum-${index}`, wrap: 'truncate' }, line)),
      ),
    );

  return h(
    Box,
    { flexDirection: 'column', height: rows, width: columns, overflow: 'hidden' },
    h(
      Text,
      { wrap: 'truncate' },
      h(Text, { bold: true }, 'silka'),
      `   hub :${port}   `,
      h(Text, { color: hubOk ? 'green' : 'red' }, hubOk ? '● vivo' : '● caído'),
      `   ${sessionLabel}`,
    ),
    panels,
    h(
      Box,
      { height: composerH, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
      composer,
    ),
    h(Text, { color: banner?.color || undefined, wrap: 'truncate' }, banner ? clip(banner.text, columns) : ' '),
    h(Text, { dimColor: true, wrap: 'truncate' }, clip('↑↓ elegir   enter envía   n nueva   i redirigir   m nota   c cancelar   ? ayuda   q salir', columns)),
  );
}

export async function runUi({ client, port, agents, models }) {
  if (!process.stdout.isTTY) {
    throw new Error('silka ui necesita una terminal interactiva.');
  }
  const instance = render(h(App, { client, port, agents, models }));
  await instance.waitUntilExit();
}
