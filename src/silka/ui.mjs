import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { clip, formatDuration, formatEvent, isBusy, promptPreview, shortId, statusColor } from './format.mjs';
import { readPrompts, rememberPrompt } from './hub.mjs';

const h = React.createElement;

function snapshotQueues(queues) {
  const out = {};
  for (const [id, items] of Object.entries(queues)) {
    if (items?.length) out[id] = [...items];
  }
  return out;
}

function App({ client, port, agents }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState('');
  const [queues, setQueues] = useState({});
  const [error, setError] = useState('');
  const [prompts, setPrompts] = useState(() => readPrompts(port));
  const [wizard, setWizard] = useState(null);

  const sessionsRef = useRef([]);
  const selectedIdRef = useRef(null);
  const draftRef = useRef('');
  const queuesRef = useRef({});
  const inflightRef = useRef({});
  const wizardRef = useRef(null);

  sessionsRef.current = sessions;
  selectedIdRef.current = selectedId;
  draftRef.current = draft;
  wizardRef.current = wizard;

  function publishQueues() {
    setQueues(snapshotQueues(queuesRef.current));
  }

  function enqueue(id, message) {
    if (!queuesRef.current[id]) queuesRef.current[id] = [];
    queuesRef.current[id].push(message);
    publishQueues();
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
            if (!cancel) setError(detail);
          }
        }

        const currentId = selectedIdRef.current;
        const current = sessionsNow.find((session) => session.sessionId === currentId) ?? sessionsNow[0];
        if (!current) {
          if (!cancel) setLines([]);
          return;
        }
        const page = await client.getSessionLogTail(current.sessionId, 30);
        if (cancel) return;
        const events = Array.isArray(page?.events) ? page.events : [];
        setLines(events.map(formatEvent));
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : String(err));
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
  }, [client]);

  async function submitDraft() {
    const id = selectedIdRef.current;
    const text = draftRef.current.trim();
    if (!id) {
      setError('No hay sesión seleccionada.');
      return;
    }
    if (!text) return;
    setDraft('');
    const session = sessionsRef.current.find((item) => item.sessionId === id);
    if (session && isBusy(session.status)) {
      enqueue(id, text);
      return;
    }
    try {
      await client.sendInput(id, text);
      inflightRef.current[id] = { turn: session?.turnCount ?? 0, seen: false, at: Date.now() };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/is still (running|cancelling)|still running/i.test(detail)) enqueue(id, text);
      else setError(detail);
    }
  }

  async function cancelSelected() {
    const id = selectedIdRef.current;
    if (!id) {
      setError('No hay sesión seleccionada.');
      return;
    }
    try {
      await client.cancelSession(id);
      if (queuesRef.current[id]) {
        queuesRef.current[id] = [];
        publishQueues();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createFromWizard() {
    const current = wizardRef.current;
    if (!current?.agent || !current.prompt.trim()) {
      setError('La sesión nueva necesita agente y prompt.');
      return;
    }
    try {
      const created = await client.createSession(
        current.agent,
        current.prompt.trim(),
        process.cwd(),
        current.model.trim() || undefined,
      );
      const sessionId = created?.sessionId;
      if (!sessionId) throw new Error('El hub no devolvió un sessionId.');
      rememberPrompt(port, sessionId, current.prompt.trim());
      setPrompts(readPrompts(port));
      setSelectedId(sessionId);
      setWizard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useInput((input, key) => {
    if (error) setError('');
    const currentWizard = wizardRef.current;
    if (currentWizard?.step === 'agent') {
      if (key.escape) {
        setWizard(null);
        return;
      }
      if (input === 'q') {
        exit();
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
        setWizard(null);
        return;
      }
      if (key.return) {
        if (currentWizard.step === 'model') setWizard({ ...currentWizard, step: 'prompt' });
        else void createFromWizard();
        return;
      }
      if (key.backspace || key.delete) {
        const field = currentWizard.step;
        setWizard({ ...currentWizard, [field]: currentWizard[field].slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const field = currentWizard.step;
        setWizard({ ...currentWizard, [field]: currentWizard[field] + input });
      }
      return;
    }

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
    if (input === 'q' && draftRef.current === '') {
      exit();
      return;
    }
    if (input === 'c' && draftRef.current === '' && !key.ctrl) {
      void cancelSelected();
      return;
    }
    if (input === 'n' && draftRef.current === '' && !key.ctrl) {
      if (!agents.length) {
        setError('No hay agentes en agent-rack.config.json.');
        return;
      }
      setWizard({ step: 'agent', index: 0, agent: agents[0], model: '', prompt: '' });
      return;
    }
    if (input && !key.ctrl && !key.meta) setDraft((value) => value + input);
  });

  const selected = sessions.find((session) => session.sessionId === selectedId) ?? sessions[0] ?? null;
  const leftWidth = Math.max(28, Math.min(42, Math.floor(columns * 0.36)));
  const rightWidth = Math.max(20, columns - leftWidth - 2);
  const queued = selected ? queues[selected.sessionId] ?? [] : [];
  const logWidth = Math.max(10, rightWidth - 4);
  const visibleLogs = lines.slice(-30).map((line) => clip(line, logWidth));
  const bodyHeight = Math.max(8, rows - 6);

  const leftRows = sessions.map((session) => {
    const active = selected?.sessionId === session.sessionId;
    const prompt = promptPreview(prompts[session.sessionId] || session.summary || '');
    return h(
      Box,
      { key: session.sessionId, flexDirection: 'column' },
      h(
        Text,
        { inverse: active },
        `${shortId(session.sessionId)} ${session.agentId} `,
        h(Text, { color: statusColor(session.status) }, session.status),
        ` ${formatDuration(session)}`,
      ),
      h(Text, { dimColor: true }, clip(prompt || 'sin prompt', leftWidth - 2)),
    );
  });

  let composer;
  if (wizard?.step === 'agent') {
    composer = h(
      Box,
      { flexDirection: 'column' },
      h(Text, { bold: true }, 'Nueva sesión — elige agente (enter, esc cancela)'),
      ...agents.map((agent, index) => h(
        Text,
        { key: agent, inverse: index === wizard.index, color: index === wizard.index ? undefined : 'cyan' },
        index === wizard.index ? `> ${agent}` : `  ${agent}`,
      )),
    );
  } else if (wizard?.step === 'model') {
    composer = h(Text, {}, `Modelo para ${wizard.agent} (enter omite): ${wizard.model}█`);
  } else if (wizard?.step === 'prompt') {
    composer = h(Text, {}, `Prompt para ${wizard.agent}: ${wizard.prompt}█`);
  } else {
    composer = h(Text, {}, `> ${draft}█`);
  }

  return h(
    Box,
    { flexDirection: 'column', height: rows },
    h(
      Box,
      { flexGrow: 1, height: bodyHeight },
      h(
        Box,
        { width: leftWidth, flexDirection: 'column', borderStyle: 'single', borderColor: 'gray', paddingX: 1 },
        h(Text, { bold: true }, 'Sesiones'),
        sessions.length ? leftRows : h(Text, { dimColor: true }, 'Sin sesiones. n crea una.'),
      ),
      h(
        Box,
        { flexGrow: 1, width: rightWidth, flexDirection: 'column', borderStyle: 'single', borderColor: 'cyan', paddingX: 1 },
        selected
          ? h(
            Text,
            { bold: true },
            `${selected.agentId} `,
            h(Text, { color: statusColor(selected.status) }, selected.status),
            ` ${shortId(selected.sessionId)}`,
          )
          : h(Text, { bold: true }, 'Actividad'),
        selected
          ? h(Text, { dimColor: true }, clip(prompts[selected.sessionId] || selected.summary || selected.workspace || '', logWidth))
          : null,
        visibleLogs.length
          ? visibleLogs.map((line, index) => h(Text, { key: `${index}:${line}` }, line))
          : h(Text, { dimColor: true }, selected ? 'Sin actividad todavía.' : 'Elige o crea una sesión.'),
        queued.length
          ? h(
            Box,
            { flexDirection: 'column', marginTop: 1 },
            h(Text, { color: 'yellow' }, 'en cola'),
            ...queued.map((message, index) => h(Text, { key: `${index}:${message}`, color: 'yellow' }, clip(`${index + 1}. ${message}`, logWidth))),
          )
          : null,
      ),
    ),
    h(Box, { borderStyle: 'single', borderColor: 'white', paddingX: 1 }, composer),
    error ? h(Text, { color: 'red' }, error) : null,
    h(Text, { dimColor: true }, '↑↓ elegir   enter envía   n nueva   c cancelar   q salir'),
  );
}

export async function runUi({ client, port, agents }) {
  if (!process.stdout.isTTY) {
    throw new Error('silka ui necesita una terminal interactiva.');
  }
  const instance = render(h(App, { client, port, agents }));
  await instance.waitUntilExit();
}
