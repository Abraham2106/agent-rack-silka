import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { redirectSession } from './commands.mjs';
import { clip, isBusy, nestSessions } from './format.mjs';
import { readMeta, rememberSession } from './hub.mjs';
import { appendNote, unreadSessionIds } from './notes.mjs';
import { readOrigins } from './origin.mjs';
import { enqueueMessage, listQueue, removeQueued } from './queue.mjs';
import { matchTaskSession, readStore, refreshConflicts, samePath, workspaceReport } from './state.mjs';
import { readConversation } from './transcript.mjs';
import { buildChatRows, flattenChatRows, renderChat } from './ui/chat.mjs';
import { renderComposer } from './ui/entry.mjs';
import { renderHelp } from './ui/help.mjs';
import { renderSessionList } from './ui/list.mjs';
import { renderEstado } from './ui/status.mjs';

const h = React.createElement;

function pendingQueue(sessionId) {
  return listQueue(sessionId).filter((item) => item.status === 'pending');
}

export function App({ client, port, agents, models = {} }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = Math.max(16, stdout?.rows ?? 24);
  const columns = Math.max(60, stdout?.columns ?? 100);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [chat, setChat] = useState({ id: null, events: [] });
  const [draft, setDraft] = useState('');
  const [field, setField] = useState('');
  const [query, setQuery] = useState('');
  const [queues, setQueues] = useState({});
  const [banner, setBanner] = useState(null);
  const [meta, setMeta] = useState(() => readMeta(port));
  const [origins, setOrigins] = useState(() => readOrigins());
  const [noted, setNoted] = useState(() => unreadSessionIds());
  const [hubOk, setHubOk] = useState(true);
  const [mode, setMode] = useState('main');
  const [wizard, setWizard] = useState(null);
  const [board, setBoard] = useState(null);
  const [hotIds, setHotIds] = useState(() => new Set());
  const [listHidden, setListHidden] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [focus, setFocus] = useState(0);
  const [pinned, setPinned] = useState(true);

  const sessionsRef = useRef([]);
  const selectedIdRef = useRef(null);
  const draftRef = useRef('');
  const fieldRef = useRef('');
  const queryRef = useRef('');
  const wizardRef = useRef(null);
  const modeRef = useRef('main');
  const orderRef = useRef([]);
  const editingRef = useRef(false);
  const listHiddenRef = useRef(false);
  const pinnedRef = useRef(true);
  const focusRef = useRef(0);
  const rowsRef = useRef([]);

  sessionsRef.current = sessions;
  selectedIdRef.current = selectedId;
  draftRef.current = draft;
  fieldRef.current = field;
  queryRef.current = query;
  wizardRef.current = wizard;
  modeRef.current = mode;
  listHiddenRef.current = listHidden;
  pinnedRef.current = pinned;
  focusRef.current = focus;

  function fail(err) {
    setBanner({ text: err instanceof Error ? err.message : String(err), color: 'red' });
  }

  function publishQueues(sessionsNow = sessionsRef.current) {
    const next = {};
    for (const session of sessionsNow) {
      const items = listQueue(session.sessionId).filter((item) => item.status !== 'delivered');
      if (items.length) next[session.sessionId] = items;
    }
    setQueues(next);
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
        setOrigins(readOrigins());
        setNoted(unreadSessionIds());
        setHubOk(true);
        publishQueues(sessionsNow);
        const dirs = new Set();
        const selectedNow = sessionsNow.find((session) => session.sessionId === selectedIdRef.current) ?? sessionsNow[0];
        if (selectedNow?.workspace) dirs.add(selectedNow.workspace);
        for (const session of sessionsNow) {
          if (isBusy(session.status) && session.workspace) dirs.add(session.workspace);
        }
        const hot = new Set();
        const fresh = Date.now() - 6 * 60 * 60 * 1000;
        for (const dir of dirs) {
          try {
            refreshConflicts(dir, sessionsNow);
            const report = workspaceReport(dir);
            if (selectedNow && samePath(selectedNow.workspace, dir)) setBoard(report);
            for (const conflict of report.conflicts) {
              if (Date.parse(conflict.at) < fresh) continue;
              for (const taskId of conflict.taskIds || []) {
                const task = report.tasks.find((item) => item.id === taskId);
                const session = task ? matchTaskSession({ ...task, workspace: dir }, sessionsNow) : null;
                if (session) hot.add(session.sessionId);
              }
            }
          } catch { /* un workspace sin estado no frena el tablero */ }
        }
        if (!dirs.size) setBoard(null);
        setHotIds(hot);

        const currentId = selectedIdRef.current;
        const current = sessionsNow.find((session) => session.sessionId === currentId) ?? sessionsNow[0];
        if (!current) {
          if (!cancel) setChat({ id: null, events: [] });
          return;
        }
        let tasks = [];
        if (current.workspace) {
          try {
            tasks = readStore(current.workspace).tasks.map((task) => ({ ...task, workspace: task.workspace || current.workspace }));
          } catch { tasks = []; }
        }
        const events = readConversation(current.sessionId, { tasks, sessions: sessionsNow });
        if (cancel || selectedIdRef.current && selectedIdRef.current !== current.sessionId) return;
        setChat({ id: current.sessionId, events });
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

  function enqueueDraft() {
    const id = selectedIdRef.current;
    const text = draftRef.current.trim();
    if (!id) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    if (!text) return false;
    const session = sessionsRef.current.find((item) => item.sessionId === id);
    if (session?.status === 'cancelled') {
      setBanner({ text: 'La sesión está cancelada.', color: 'red' });
      return false;
    }
    try {
      enqueueMessage(id, { author: 'tú', text });
      editingRef.current = false;
      setDraft('');
      setPinned(true);
      publishQueues();
      setBanner({ text: 'En cola: se envía al terminar el turno.', color: 'yellow' });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  function editLastQueued() {
    const id = selectedIdRef.current;
    if (!id || draftRef.current.trim()) return false;
    const last = pendingQueue(id).at(-1);
    if (!last) return false;
    removeQueued(id, last.id);
    editingRef.current = true;
    setDraft(last.text);
    publishQueues();
    return true;
  }

  function dropQueued() {
    const id = selectedIdRef.current;
    if (!id) return;
    if (editingRef.current || draftRef.current.trim()) {
      editingRef.current = false;
      setDraft('');
      return;
    }
    const last = pendingQueue(id).at(-1);
    if (!last) return;
    removeQueued(id, last.id);
    publishQueues();
    setBanner({ text: 'Mensaje quitado de la cola.', color: 'yellow' });
  }

  function toggleTool() {
    const list = rowsRef.current;
    const index = pinnedRef.current ? list.length - 1 : focusRef.current;
    const row = list[index];
    if (!row?.toolId || (row.kind !== 'tool' && row.kind !== 'detail')) return false;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(row.toolId)) next.delete(row.toolId);
      else next.add(row.toolId);
      return next;
    });
    setPinned(false);
    return true;
  }

  function moveChat(delta) {
    const last = Math.max(0, rowsRef.current.length - 1);
    const base = pinnedRef.current ? last : focusRef.current;
    const next = Math.min(last, Math.max(0, base + delta));
    focusRef.current = next;
    setFocus(next);
    const atEnd = next >= last;
    pinnedRef.current = atEnd;
    setPinned(atEnd);
  }

  async function cancelSelected() {
    const id = selectedIdRef.current;
    if (!id) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    try {
      await client.cancelSession(id);
      setBanner({ text: `Cancelando ${id.slice(0, 8)}.`, color: 'yellow' });
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
      setBanner({ text: `Sesión ${sessionId.slice(0, 8)} creada.`, color: 'green' });
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
      setBanner({ text: `Redirigida ${session.sessionId.slice(0, 8)} → ${createdId.slice(0, 8)}.`, color: 'green' });
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
    if (currentMode === 'estado') {
      if (key.escape || input === 'e' || input === 'q') setMode('main');
      return;
    }
    if (currentMode === 'confirm') {
      if (input === 's' || input === 'S' || input === 'y' || input === 'Y') void cancelSelected();
      setMode('main');
      return;
    }
    if (currentMode === 'search') {
      if (key.escape) {
        setQuery('');
        setMode('main');
        return;
      }
      if (key.return) {
        setMode('main');
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setQuery((value) => value + input);
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

    if (key.ctrl && (input === 'b' || input === 'B' || input === '\u0002')) {
      setListHidden((value) => !value);
      return;
    }
    if (banner) setBanner(null);

    if (key.pageUp) {
      moveChat(-1);
      return;
    }
    if (key.pageDown) {
      moveChat(1);
      return;
    }
    if (key.escape) {
      dropQueued();
      return;
    }

    const list = orderRef.current.length ? orderRef.current : sessionsRef.current.map((session) => ({ session, depth: 0 }));
    if (key.upArrow) {
      if (!draftRef.current.trim() && editLastQueued()) return;
      if (draftRef.current.trim()) return;
      if (listHiddenRef.current) {
        moveChat(-1);
        return;
      }
      if (!list.length) return;
      let index = list.findIndex((item) => item.session.sessionId === selectedIdRef.current);
      if (index < 0) index = 0;
      const next = list[Math.max(0, index - 1)];
      setSelectedId(next.session.sessionId);
      setPinned(true);
      return;
    }
    if (key.downArrow) {
      if (draftRef.current.trim()) return;
      if (listHiddenRef.current) {
        moveChat(1);
        return;
      }
      if (!list.length) return;
      let index = list.findIndex((item) => item.session.sessionId === selectedIdRef.current);
      if (index < 0) index = 0;
      const next = list[Math.min(list.length - 1, index + 1)];
      setSelectedId(next.session.sessionId);
      setPinned(true);
      return;
    }
    if (key.return) {
      if (draftRef.current.trim()) enqueueDraft();
      else toggleTool();
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((value) => value.slice(0, -1));
      return;
    }
    if (input === '/' && draftRef.current === '' && !key.ctrl) {
      setQuery('');
      setMode('search');
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
    if (input === 'e' && draftRef.current === '' && !key.ctrl) {
      setMode('estado');
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
  const leftWidth = listHidden ? 0 : Math.max(28, Math.min(40, Math.floor(columns * 0.38)));
  const rightWidth = Math.max(20, columns - leftWidth);
  const queued = selected ? queues[selected.sessionId] ?? [] : [];
  const events = chat.id && selected && chat.id === selected.sessionId ? chat.events : [];

  let composerInner = 2;
  if (wizard?.step === 'agent') composerInner = 1 + Math.max(agents.length, 1);
  else if (wizard?.step === 'model' || mode === 'confirm' || mode === 'search') composerInner = 2;
  else if (wizard?.step === 'prompt') composerInner = 4;
  else if (mode === 'steer' || mode === 'note') composerInner = 2;
  const composerH = Math.min(composerInner + 2, Math.max(3, rows - 8));
  const bodyH = Math.max(1, rows - composerH - 3);
  const ordered = nestSessions(sessions, origins, meta);
  orderRef.current = ordered;

  const flatRows = flattenChatRows(buildChatRows(events, queued, query), expanded);
  rowsRef.current = flatRows;

  const sessionLabel = `${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}`;
  const panels = mode === 'estado'
    ? renderEstado(h, Box, Text, { height: bodyH, columns, board })
    : mode === 'help'
      ? renderHelp(h, Box, Text, { height: bodyH, columns })
      : h(
        Box,
        { flexGrow: 1, height: bodyH, overflow: 'hidden' },
        listHidden ? null : renderSessionList(h, Box, Text, {
          ordered, selectedId: selected?.sessionId, meta, models, origins, noted, hotIds, queues,
          width: leftWidth, height: bodyH,
        }),
        renderChat(h, Box, Text, {
          session: selected, meta, origins, models, events, queued,
          width: listHidden ? columns : rightWidth,
          height: bodyH,
          query, expanded, focus, pinned,
        }),
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
      listHidden ? '   chat' : '',
    ),
    panels,
    h(
      Box,
      { height: composerH, borderStyle: 'single', borderColor: 'gray', paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
      mode === 'estado'
        ? h(Text, { dimColor: true, wrap: 'truncate' }, 'Estado del proyecto · e o esc vuelve')
        : renderComposer(h, Box, Text, { mode, draft, field, wizard, agents, columns, selected, query }),
    ),
    h(Text, { color: banner?.color || undefined, wrap: 'truncate' }, banner ? clip(banner.text, columns) : ' '),
    h(Text, { dimColor: true, wrap: 'truncate' }, clip('↑↓ elegir   enter encola   n nueva   e estado   i redirigir   m nota   c cancelar   ? ayuda   q salir', columns)),
  );
}

export async function runUi({ client, port, agents, models }) {
  if (!process.stdout.isTTY) {
    throw new Error('silka ui necesita una terminal interactiva.');
  }
  const instance = render(h(App, { client, port, agents, models }));
  await instance.waitUntilExit();
}
