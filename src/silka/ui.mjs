import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { sendToSession } from './commands.mjs';
import { clip, isBusy, nestSessions, statusIcon } from './format.mjs';
import { readMeta, rememberSession } from './hub.mjs';
import {
  MODIFY_OTHER_KEYS_OFF,
  MODIFY_OTHER_KEYS_ON,
  MOUSE_OFF,
  MOUSE_ON,
  installInputFix,
  isSendNowKey,
} from './keys.mjs';
import { appendNote, unreadSessionIds } from './notes.mjs';
import { readOrigins } from './origin.mjs';
import { listQueue, removeQueued } from './queue.mjs';
import { matchTaskSession, readStore, refreshConflicts, samePath, workspaceReport } from './state.mjs';
import { readConversation } from './transcript.mjs';
import { buildChatRows, flattenChatRows, renderChat } from './ui/chat.mjs';
import { PICKER_ROWS, renderComposer } from './ui/entry.mjs';
import { segLine, wordmark } from './ui/paint.mjs';
import { animOn, c, palette, statusTone } from './ui/theme.mjs';
import { cachedModels, loadModels, pickerItems, recentModels, rememberRecentModel, setDefaultModel } from './models.mjs';
import { loadSilkaConfig } from './hub.mjs';
import { renderHelp } from './ui/help.mjs';
import { renderSessionList } from './ui/list.mjs';
import { renderEstado } from './ui/status.mjs';

const h = React.createElement;

/** Alto exacto de la terminal: si el layout se pasa, Ink ensucia el scrollback. */
export function frameLayout(termRows, { composerInner = 2 } = {}) {
  const rows = Math.max(1, Number(termRows) || 1);
  const header = rows >= 12 ? 2 : rows >= 1 ? 1 : 0;
  const footer = rows >= 3 ? 1 : 0;
  const banner = rows >= 4 ? 1 : 0;
  const room = rows - header - footer - banner;
  let composer = 0;
  let body = 0;
  if (room < 4) body = Math.max(0, room);
  else {
    composer = Math.max(3, Math.min(composerInner + 2, room - 1));
    body = room - composer;
  }
  const used = header + body + composer + banner + footer;
  if (used < rows) body += rows - used;
  if (used > rows) body = Math.max(0, body - (used - rows));
  return { rows, header, body, composer, banner, footer };
}

/** Atajos del pie: la tecla resalta, la acción queda atenuada. Se recortan si no caben. */
export function footerKeys(width) {
  const keys = [['tab', 'cambia'], ['n', 'nueva'], ['e', 'estado'], ['m', 'nota'], ['c', 'cancela'], ['/', 'busca'], ['ctrl+b', 'lista'], ['?', 'ayuda'], ['q', 'sale']];
  const segs = [];
  let used = 0;
  for (const [key, label] of keys) {
    const len = key.length + label.length + 4;
    if (used + len > width) break;
    segs.push({ text: key, color: palette.steelDim, bold: true }, { text: ` ${label}   `, color: palette.muted });
    used += len;
  }
  return segs;
}

export function uiRenderOptions(env = process.env) {
  const fullscreen = env.SILKA_NO_FULLSCREEN !== '1';
  return {
    alternateScreen: fullscreen,
    maxFps: 10,
    incrementalRendering: true,
    kittyKeyboard: fullscreen ? { mode: 'auto' } : undefined,
  };
}

function pendingQueue(sessionId) {
  return listQueue(sessionId).filter((item) => item.status === 'pending');
}

export function App({ client, port, agents, models = {} }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [term, setTerm] = useState(() => ({
    rows: stdout?.rows || 24,
    columns: stdout?.columns || 100,
  }));
  const rows = term.rows;
  const columns = term.columns;
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
  const [listHidden, setListHidden] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [focus, setFocus] = useState(0);
  const [pinned, setPinned] = useState(true);
  const [queueId, setQueueId] = useState(null);
  const [frameTick, setFrameTick] = useState(0);
  const [catalogs, setCatalogs] = useState({});
  const [defaults, setDefaults] = useState(() => ({ ...models }));

  const sessionsRef = useRef([]);
  const selectedIdRef = useRef(null);
  const draftRef = useRef('');
  const fieldRef = useRef('');
  const queryRef = useRef('');
  const wizardRef = useRef(null);
  const modeRef = useRef('main');
  const orderRef = useRef([]);
  const editingRef = useRef(false);
  const listHiddenRef = useRef(true);
  const pinnedRef = useRef(true);
  const focusRef = useRef(0);
  const rowsRef = useRef([]);
  const queueIdRef = useRef(null);
  const pageRef = useRef(8);
  const signatureRef = useRef('');

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
  queueIdRef.current = queueId;

  function fail(err) {
    setBanner({ text: err instanceof Error ? err.message : String(err), color: 'red' });
  }

  function queuesFrom(sessionsNow = sessionsRef.current) {
    const next = {};
    for (const session of sessionsNow) {
      const items = listQueue(session.sessionId).filter((item) => item.status !== 'delivered');
      if (items.length) next[session.sessionId] = items;
    }
    return next;
  }

  function publishQueues(sessionsNow = sessionsRef.current) {
    setQueues(queuesFrom(sessionsNow));
  }

  useEffect(() => {
    if (!stdout?.on) return undefined;
    const apply = () => setTerm({
      rows: stdout.rows || 24,
      columns: stdout.columns || 100,
    });
    apply();
    stdout.on('resize', apply);
    return () => stdout.off?.('resize', apply);
  }, [stdout]);

  const selectedBusy = isBusy(sessions.find((s) => s.sessionId === selectedId)?.status);
  useEffect(() => {
    if (!selectedBusy || !animOn()) return undefined;
    const timer = setInterval(() => setFrameTick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [selectedBusy]);

  /** Catálogo del agente: primero lo que hay en caché (instantáneo), luego el CLI si está viejo. */
  function loadCatalog(agent) {
    setCatalogs((all) => ({ ...all, [agent]: { ...cachedModels(agent), loading: true } }));
    loadModels(agent)
      .then((cat) => setCatalogs((all) => ({ ...all, [agent]: { ...cat, loading: false } })))
      .catch((err) => setCatalogs((all) => ({ ...all, [agent]: { ...(all[agent] || {}), loading: false, error: err.message } })));
  }

  function pickerFor(current) {
    if (!current || current.step !== 'model') return null;
    const cat = catalogs[current.agent] || { models: [], loading: true };
    const items = pickerItems(cat, { query: current.model, defaultModel: defaults[current.agent] || '', recents: recentModels(current.agent) });
    return { items, total: cat.total ?? cat.models?.length ?? 0, loading: cat.loading, error: cat.error };
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
    let painted = false;

    async function tick() {
      if (running || cancel) return;
      running = true;
      try {
        const list = await client.listSessions();
        if (cancel) return;
        const sessionsNow = Array.isArray(list) ? list : [];
        // Primer cuadro: pinta la lista ya (el hub responde en ms). El estado de cada
        // workspace (git, conflictos) llega después sin bloquear la lista.
        if (!painted) {
          painted = true;
          setSessions(sessionsNow);
          setOrigins(readOrigins());
          setHubOk(true);
        }
        const queuedMap = queuesFrom(sessionsNow);
        const dirs = new Set();
        const selectedNow = sessionsNow.find((session) => session.sessionId === selectedIdRef.current) ?? sessionsNow[0];
        if (selectedNow?.workspace) dirs.add(selectedNow.workspace);
        for (const session of sessionsNow) {
          if (isBusy(session.status) && session.workspace) dirs.add(session.workspace);
        }
        const hot = new Set();
        let nextBoard = null;
        const fresh = Date.now() - 6 * 60 * 60 * 1000;
        for (const dir of dirs) {
          try {
            refreshConflicts(dir, sessionsNow);
            const report = workspaceReport(dir);
            if (selectedNow && samePath(selectedNow.workspace, dir)) nextBoard = report;
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
        const clearBoard = !dirs.size;

        const currentId = selectedIdRef.current;
        const current = sessionsNow.find((session) => session.sessionId === currentId) ?? sessionsNow[0];
        let events = [];
        if (current) {
          let tasks = [];
          if (current.workspace) {
            try {
              tasks = readStore(current.workspace).tasks.map((task) => ({ ...task, workspace: task.workspace || current.workspace }));
            } catch { tasks = []; }
          }
          events = readConversation(current.sessionId, { tasks, sessions: sessionsNow });
        }
        if (cancel || (current && selectedIdRef.current && selectedIdRef.current !== current.sessionId)) return;
        const sign = [
          sessionsNow.map((session) => `${session.sessionId}:${session.status}:${session.turnCount || 0}`).join(','),
          events.map((event) => event.id).join(','),
          Object.entries(queuedMap).map(([id, items]) => `${id}:${items.map((item) => `${item.id}${item.now ? '!' : ''}`).join(',')}`).join('|'),
          [...hot].sort().join(','),
        ].join('#');
        if (sign === signatureRef.current) return;
        signatureRef.current = sign;
        setSessions(sessionsNow);
        setMeta(readMeta(port));
        setOrigins(readOrigins());
        setNoted(unreadSessionIds());
        setHubOk(true);
        setQueues(queuedMap);
        setHotIds(hot);
        setBoard(clearBoard ? null : nextBoard);
        setChat(current ? { id: current.sessionId, events } : { id: null, events: [] });
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

  function selectedSession() {
    const id = selectedIdRef.current;
    return sessionsRef.current.find((item) => item.sessionId === id) || null;
  }

  function enqueueDraft() {
    const session = selectedSession();
    const text = draftRef.current.trim();
    if (!session) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return false;
    }
    if (!text) return false;
    try {
      sendToSession(session, { text, author: 'tú', now: false });
      editingRef.current = false;
      setDraft('');
      setQueueId(null);
      setPinned(true);
      signatureRef.current = '';
      publishQueues();
      setBanner({ text: 'En cola: se envía al terminar el turno.', color: 'yellow' });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  function moveQueue(step) {
    const id = selectedIdRef.current;
    const items = pendingQueue(id);
    if (!items.length || draftRef.current.trim()) return false;
    const current = items.findIndex((item) => item.id === queueIdRef.current);
    const index = current < 0 ? items.length : current;
    const next = index + step;
    if (next < 0) return true;
    if (next >= items.length) {
      setQueueId(null);
      return step > 0;
    }
    setQueueId(items[next].id);
    return true;
  }

  function dropQueued() {
    const id = selectedIdRef.current;
    if (!id) return;
    if (draftRef.current.trim()) {
      editingRef.current = false;
      setDraft('');
      return;
    }
    const picked = queueIdRef.current;
    const target = picked
      ? pendingQueue(id).find((item) => item.id === picked)
      : pendingQueue(id).at(-1);
    if (!target) return;
    removeQueued(id, target.id);
    setQueueId(null);
    signatureRef.current = '';
    publishQueues();
    setBanner({ text: 'Mensaje quitado de la cola.', color: 'yellow' });
  }

  function deliverNow() {
    const session = selectedSession();
    if (!session) {
      setBanner({ text: 'No hay sesión seleccionada.', color: 'red' });
      return;
    }
    const picked = queueIdRef.current;
    const draft = draftRef.current.trim();
    try {
      const result = picked && !draft
        ? sendToSession(session, { messageId: picked, author: 'tú', now: true })
        : sendToSession(session, { text: draft, author: 'tú', now: true });
      setDraft('');
      setQueueId(null);
      setPinned(true);
      signatureRef.current = '';
      publishQueues();
      const text = result.interrupted
        ? 'Enviado ya. Retoma en cuanto suelte la herramienta.'
        : 'El turno ya terminó: se envía como un turno normal.';
      setBanner({ text, color: result.interrupted ? 'green' : 'yellow' });
    } catch (err) {
      fail(err);
    }
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
      const model = String(current.chosen || '').trim();
      const prompt = current.prompt.trim();
      if (model) rememberRecentModel(current.agent, model);
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
        setWizard((w) => ({ ...w, index: Math.max(0, (w?.index || 0) - 1) }));
        return;
      }
      if (key.downArrow) {
        setWizard((w) => ({ ...w, index: Math.min(agents.length - 1, (w?.index || 0) + 1) }));
        return;
      }
      if (key.return && agents.length) {
        const agent = agents[currentWizard.index];
        loadCatalog(agent);
        setWizard({ ...currentWizard, step: 'model', agent, model: '', mIndex: 0, confirmTyped: false, chosen: '' });
      }
      return;
    }
    if (currentWizard?.step === 'model') {
      const picker = pickerFor(currentWizard);
      const items = picker?.items || [];
      if (key.escape) { setWizard({ ...currentWizard, step: 'agent' }); return; }
      if (key.upArrow) { setWizard((w) => ({ ...w, mIndex: Math.max(0, (w?.mIndex || 0) - 1) })); return; }
      if (key.downArrow) { setWizard((w) => ({ ...w, mIndex: Math.min(Math.max(0, items.length - 1), (w?.mIndex || 0) + 1) })); return; }
      if (key.ctrl && (input === 'd' || input === String.fromCharCode(4))) {
        const target = items[currentWizard.mIndex || 0];
        if (!target) return;
        try {
          const { configPath } = loadSilkaConfig();
          setDefaultModel(configPath, currentWizard.agent, target.id);
          setDefaults((all) => ({ ...all, [currentWizard.agent]: target.id }));
          setBanner({ text: `${target.id} es ahora el modelo por defecto de ${currentWizard.agent}.`, color: palette.ok });
        } catch (err) { fail(err); }
        return;
      }
      if (key.return) {
        const typed = String(currentWizard.model || '').trim();
        const pick = items[currentWizard.mIndex || 0];
        if (pick) {
          if (pick.available === false) setBanner({ text: `${pick.id} falló antes con tu cuenta; puede volver a fallar.`, color: palette.run });
          setWizard({ ...currentWizard, step: 'prompt', chosen: pick.id });
          return;
        }
        if (!typed) { setWizard({ ...currentWizard, step: 'prompt', chosen: '' }); return; }
        if (!currentWizard.confirmTyped) { setWizard({ ...currentWizard, confirmTyped: true }); return; }
        setWizard({ ...currentWizard, step: 'prompt', chosen: typed });
        return;
      }
      if (key.backspace || key.delete) {
        setWizard({ ...currentWizard, model: String(currentWizard.model || '').slice(0, -1), mIndex: 0, confirmTyped: false });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setWizard((w) => ({ ...w, model: String(w?.model || '') + input.replaceAll(String.fromCharCode(13), ''), mIndex: 0, confirmTyped: false }));
      }
      return;
    }
    if (currentWizard && currentWizard.step === 'prompt') {
      if (key.escape) {
        setWizard({ ...currentWizard, step: 'model' });
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

    if (key.tab && !draftRef.current.trim()) {
      const list = orderRef.current.length ? orderRef.current : sessionsRef.current.map((session) => ({ session, depth: 0 }));
      if (!list.length) return;
      let index = list.findIndex((item) => item.session.sessionId === selectedIdRef.current);
      if (index < 0) index = 0;
      const next = list[(index + (key.shift ? list.length - 1 : 1)) % list.length];
      setSelectedId(next.session.sessionId);
      setPinned(true);
      return;
    }
    if (key.ctrl && (input === 'b' || input === 'B' || input === '\u0002')) {
      setListHidden((value) => !value);
      return;
    }
    if (banner) setBanner(null);

    if (key.pageUp) {
      moveChat(-pageRef.current);
      return;
    }
    if (key.pageDown) {
      moveChat(pageRef.current);
      return;
    }
    if (key.home) {
      focusRef.current = 0;
      setFocus(0);
      pinnedRef.current = false;
      setPinned(false);
      return;
    }
    if (key.end) {
      const last = Math.max(0, rowsRef.current.length - 1);
      focusRef.current = last;
      setFocus(last);
      pinnedRef.current = true;
      setPinned(true);
      return;
    }
    if (key.escape) {
      dropQueued();
      return;
    }

    const list = orderRef.current.length ? orderRef.current : sessionsRef.current.map((session) => ({ session, depth: 0 }));
    if (key.upArrow) {
      if (moveQueue(-1)) return;
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
      if (queueIdRef.current && moveQueue(1)) return;
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
    if (isSendNowKey(input, key)) {
      deliverNow();
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
      setBanner({ text: 'Ctrl+Enter o Alt+Enter envían ya. Enter deja el mensaje en cola.', color: 'yellow' });
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
      setWizard({ step: 'agent', index: 0, agent: agents[0], model: '', prompt: '', mIndex: 0, chosen: '' });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQueueId(null);
      setDraft((value) => value + input);
    }
  });

  const selected = sessions.find((session) => session.sessionId === selectedId) ?? sessions[0] ?? null;
  const leftWidth = listHidden ? 0 : Math.max(28, Math.min(40, Math.floor(columns * 0.38)));
  const rightWidth = Math.max(20, columns - leftWidth);
  const queued = selected ? queues[selected.sessionId] ?? [] : [];
  const events = chat.id && selected && chat.id === selected.sessionId ? chat.events : [];

  let composerInner = 2;
  if (wizard?.step === 'agent') composerInner = 1 + Math.max(agents.length, 1);
  else if (wizard?.step === 'model') composerInner = 4 + PICKER_ROWS;
  else if (mode === 'confirm' || mode === 'search') composerInner = 2;
  else if (wizard?.step === 'prompt') composerInner = 4;
  else if (mode === 'steer' || mode === 'note') composerInner = 2;
  const frame = frameLayout(rows, { composerInner });
  const composerH = frame.composer;
  const bodyH = frame.body;
  pageRef.current = Math.max(1, bodyH - 3);
  const ordered = nestSessions(sessions, origins, meta);
  orderRef.current = ordered;

  const chatInner = Math.max(8, (listHidden ? columns : rightWidth) - 3);
  const flatRows = flattenChatRows(buildChatRows(events, queued, query), expanded, chatInner);
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
          ordered, selectedId: selected?.sessionId, meta, models: defaults, origins, noted, hotIds, queues,
          width: leftWidth, height: bodyH,
        }),
        renderChat(h, Box, Text, {
          session: selected, meta, origins, models: defaults, events, queued,
          width: listHidden ? columns : rightWidth,
          height: bodyH,
          query, expanded, focus, pinned,
          selectedQueueId: queueId,
          frame: frameTick,
        }),
      );

  // Encabezado: marca con el degradado del logo, estado del hub y del taller, y UNA línea debajo.
  const working = sessions.filter((s) => isBusy(s.status)).length;
  const tabs = [];
  let tabRoom = columns - 12;
  for (const { session } of ordered) {
    const on = session.sessionId === selected?.sessionId;
    const label = `${statusIcon(session.status)} ${session.agentId}`;
    if (tabRoom < label.length + 3) { tabs.push({ text: ' …', color: palette.muted }); break; }
    tabRoom -= label.length + 3;
    tabs.push({ text: '  ' }, { text: ` ${label} `, color: on ? '#0d0c11' : statusTone(session.status), backgroundColor: on ? palette.prompt : undefined, bold: on });
  }
  const headSegsOld = [
    { text: ' ◆ ', color: palette.edge },
    ...wordmark('silka'),
    { text: '   hub ', color: palette.muted },
    { text: `:${port} `, color: palette.steelDim },
    { text: hubOk ? '●' : '●', color: hubOk ? palette.ok : palette.bad },
    { text: hubOk ? ' vivo' : ' caído', color: hubOk ? palette.muted : palette.bad },
    { text: `   ${sessionLabel}`, color: palette.muted },
    ...(working ? [{ text: `  ·  ${working} trabajando`, color: palette.run }] : []),
    ...(listHidden ? [{ text: '  ·  chat completo', color: palette.muted }] : []),
  ];
  const header = frame.header
    ? h(
      Box,
      frame.header >= 2
        ? { height: frame.header, overflow: 'hidden', borderStyle: 'single', borderColor: c(palette.rule), borderTop: false, borderLeft: false, borderRight: false }
        : { height: frame.header, overflow: 'hidden' },
      segLine(h, Text, [{ text: ' silka', color: palette.title, bold: true }, ...(tabs.length ? tabs : [{ text: '   sin sesiones', color: palette.muted }]), { text: working ? `    ${working} trabajando` : '', color: palette.tool }], 'head'),
    )
    : null;
  const picker = pickerFor(wizard);
  // Caja de entrada: solo una línea arriba, como Antigravity; nada de caja cerrada.
  const composer = frame.composer
    ? h(
      Box,
      { height: frame.composer, borderStyle: 'single', borderColor: c(palette.rule), borderBottom: false, borderLeft: false, borderRight: false, paddingX: 1, flexDirection: 'column', overflow: 'hidden' },
      mode === 'estado'
        ? segLine(h, Text, [{ text: 'Estado del proyecto · e o esc vuelve', color: palette.muted }], 'estado')
        : renderComposer(h, Box, Text, { mode, draft, field, wizard, agents, columns, selected, query, picker }),
    )
    : null;
  const bannerColor = { red: palette.bad, yellow: palette.run, green: palette.ok }[banner?.color] || banner?.color;
  const bannerRow = frame.banner
    ? h(Box, { height: frame.banner, overflow: 'hidden', paddingX: 1 }, banner
      ? segLine(h, Text, [{ text: clip(banner.text, columns - 2), color: bannerColor || palette.ink }], 'banner')
      : h(Text, null, ' '))
    : null;
  const footer = frame.footer
    ? h(Box, { height: frame.footer, overflow: 'hidden', paddingX: 1 }, segLine(h, Text, footerKeys(columns - 2), 'foot'))
    : null;

  return h(
    Box,
    { flexDirection: 'column', height: frame.rows, width: columns, overflow: 'hidden' },
    header,
    panels,
    bannerRow,
    composer,
    footer,
  );
}

export async function runUi({ client, port, agents, models }) {
  if (!process.stdout.isTTY) {
    throw new Error('silka ui necesita una terminal interactiva.');
  }
  const options = uiRenderOptions();
  const fullscreen = options.alternateScreen;
  const stopInput = fullscreen ? installInputFix(process.stdin) : () => {};
  if (fullscreen) process.stdout.write(MODIFY_OTHER_KEYS_ON + MOUSE_ON);
  try {
    const instance = render(h(App, { client, port, agents, models }), options);
    await instance.waitUntilExit();
  } finally {
    stopInput();
    if (fullscreen && process.stdout.isTTY) process.stdout.write(MOUSE_OFF + MODIFY_OTHER_KEYS_OFF);
  }
}
