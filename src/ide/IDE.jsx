import * as React from 'react';
import { Button, Menu, Panel, Progress, Readout, Select, Slider, Status, Switch, Tag, Tooltip, useToast } from '@monohud/react';
import { SKETCH_NAMES, createRuntime, errorLine } from './runtime.js';
import { friendlyError, lintSketch } from './lint.js';
import { SKETCHES, fillSketch } from './examples.js';
import { BOARDS, BOARD_ITEMS, CAPS, CAP_VOLTS, COMPONENTS, RAIL_LENGTHS, railHoles, resizeRail, MODULES, PARTS, RESISTORS, componentDemo, defaultLayout, fmtR, netlist, newId, partLabels, propsOf, sketchPins } from './boards.js';
import { createCircuit } from './circuit.js';
import { LESSONS, LESSON_ITEMS } from './lessons.js';
import { LEDC } from '../models.js';
import { createWiringBench } from './bench.js';
import { finite, openProject, saveProject } from '../projectFile.js';

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
// How to use a part on the bench once it is selected.
const USE_HINT = {
  toggle: 'Click it to switch it on or off', button: 'Hold the mouse on it to press it', pir: 'Click it to wave a hand in front',
  ir: 'Click it to put an object in front', pot: 'Scroll on it to turn the knob', ldr: 'Scroll on it to change the light',
  soil: 'Scroll on it to make the soil wetter or drier', sonar: 'Scroll on it to move the object nearer or further',
  dht: 'Scroll on it to change the temperature (Shift + scroll: humidity)',
};
const BAUDS = [9600, 57600, 115200].map((b) => ({ value: b, label: `${b} baud` }));
const SKETCH_ITEMS = Object.entries(SKETCHES).map(([value, s]) => ({ value, label: s.name }));
const MAX_SERIAL = 400;
const garble = (s) => s.replace(/[^\n]/g, () => '�ÿ¤þ'[Math.floor(Math.random() * 4)]);
const envFor = (env, o) => ({ ...PARTS[o.type].env, ...env[o.id] });

/** A layout read from a file, checked piece by piece. Returns null when it cannot be used. */
function validLayout(l) {
  if (!l || !BOARDS[l.board] || !Array.isArray(l.objects) || !Array.isArray(l.wires)) return null;
  const known = (o) => o && typeof o.id === 'string' && (o.kind === 'board' ? BOARDS[o.type] : o.kind === 'part' && PARTS[o.type]) && finite(o.x) && finite(o.y);
  if (!l.objects.every(known) || l.objects.filter((o) => o.kind === 'board').length !== 1) return null;
  const ids = new Set(l.objects.map((o) => o.id));
  const wires = l.wires.filter((w) => w && typeof w.a === 'string' && typeof w.b === 'string' && ids.has(w.a.split(':')[0]) && ids.has(w.b.split(':')[0]));
  return { ...l, wires };
}

function loadLayout() {
  const l = store.get('cbh-ide-layout', null);
  return l && BOARDS[l.board] && Array.isArray(l.objects) ? l : defaultLayout('esp32');
}

export function IDE({ active }) {
  const { toast } = useToast();
  const [layout, setLayout] = React.useState(loadLayout);
  // Undo history for the bench. A gesture key (e.g. dragging one part) folds its steps into one entry.
  const hist = React.useRef({ past: [], future: [], key: null });
  const [, setHistVer] = React.useState(0);
  const commit = React.useCallback((next, key) => {
    const h = hist.current, prev = refs.current.layout;
    const n = typeof next === 'function' ? next(prev) : next;
    if (n === prev) return;
    if (!(key && key === h.key)) { h.past.push(prev); if (h.past.length > 200) h.past.shift(); }
    h.future = []; h.key = key || null;
    refs.current.layout = n; setLayout(n); setHistVer((v) => v + 1);
  }, []);
  const travel = React.useCallback((back) => {
    const h = hist.current, from = back ? h.past : h.future, to = back ? h.future : h.past;
    if (!from.length) return;
    to.push(refs.current.layout); const n = from.pop(); h.key = null;
    refs.current.layout = n; setLayout(n); setHistVer((v) => v + 1);
    bench.current?.select(null);
  }, []);
  const [code, setCode] = React.useState(() => store.get('cbh-ide-code', null) ?? fillSketch(SKETCHES.dashboard.code, sketchPins(layout, netlist(layout))));
  const [lastExample, setLastExample] = React.useState(() => store.get('cbh-ide-example', { key: 'dashboard', filled: null }));
  const [env, setEnv] = React.useState({});
  const [state, setState] = React.useState({ status: 'idle', error: '', line: null, upload: 0, errLines: [] });
  const editorRef = React.useRef(null);
  // Put the caret on a line and scroll it into view.
  const goToLine = (n) => {
    const ta = editorRef.current; if (!ta || !n) return;
    const lines = ta.value.split('\n'), start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
    ta.focus(); ta.setSelectionRange(start, start + (lines[n - 1]?.length || 0));
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; ta.scrollTop = Math.max(0, (n - 4) * lh);
  };
  const [serial, setSerial] = React.useState([]);
  const [monitorBaud, setMonitorBaud] = React.useState(115200);
  const [selection, setSelection] = React.useState(null);
  const [lesson, setLesson] = React.useState(null);
  const [, setTick] = React.useState(0);
  const rt = React.useRef(null), started = React.useRef(0), oled = React.useRef({ bits: new Uint8Array(8192), on: false });
  const benchCv = React.useRef(null), bench = React.useRef(null), oledCv = React.useRef(null), timers = React.useRef({});
  const nl = React.useMemo(() => netlist(layout), [layout]);
  const labels = React.useMemo(() => partLabels(layout), [layout]);
  const B = BOARDS[layout.board];
  const refs = React.useRef({}); Object.assign(refs.current, { layout, nl, env, monitorBaud, labels });
  // The circuit solver reads the bench and the sketch's pin states; it runs whether or not a sketch is loaded.
  const circuit = React.useMemo(() => createCircuit({
    get: () => ({ layout: refs.current.layout, nl: refs.current.nl, env: refs.current.env, pins: rt.current?.pins || {} }),
    onFail: (o, msg, info = {}) => {
      bench.current?.effect(o?.id, info);
      const name = o ? refs.current.labels.get(o.id) || PARTS[o.type].name : BOARDS[refs.current.layout.board].name;
      pushSerialRef.current(`[sim] ${name} ${msg}\n`, 'err');
      toast({ title: info.type === 'short' ? 'Short circuit' : `${name} ${info.type === 'pin' ? 'pin damaged' : 'failed'}`, description: msg, type: 'danger', timeout: 4000 });
      // A short browns the board out: the sketch stops until power is restored.
      if (info.type === 'short' && rt.current) { rt.current.stop(); rt.current = null; setState((st) => ({ ...st, status: 'idle' })); }
    },
    onWarn: (msg) => pushSerialRef.current(`[sim] ${msg}\n`, 'warn'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const pushSerialRef = React.useRef(() => {});
  React.useEffect(() => { if (!active) return undefined; const id = setInterval(() => circuit.step(), 30); return () => clearInterval(id); }, [active, circuit]);

  React.useEffect(() => store.set('cbh-ide-code', code), [code]);
  React.useEffect(() => store.set('cbh-ide-layout', layout), [layout]);
  React.useEffect(() => store.set('cbh-ide-example', lastExample), [lastExample]);
  React.useEffect(() => { if (!active) return undefined; const id = setInterval(() => setTick((x) => x + 1), 100); return () => clearInterval(id); }, [active]);
  React.useEffect(() => () => rt.current?.stop(), []);
  const keys = React.useRef({}); // latest handlers for the shortcuts below
  React.useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.target.closest?.('textarea,input,[contenteditable]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); travel(true); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); travel(false); }
      else if (key === 'c') { e.preventDefault(); keys.current.copy(); }
      else if (key === 'v') { e.preventDefault(); keys.current.paste(); }
      else if (key === 'd') { e.preventDefault(); keys.current.copy(); keys.current.paste(); }
      else if (key === 'a') { e.preventDefault(); keys.current.all(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, travel]);

  /* ---------- bench canvas ---------- */
  React.useEffect(() => {
    const b = createWiringBench(benchCv.current, {
      getLayout: () => refs.current.layout,
      setLayout: (next, key) => commit(next, key),
      endGesture: () => { hist.current.key = null; },
      onSelect: setSelection,
      onInteract: (...a) => interactRef.current(...a),
      onPress: (id, down) => setEnv((e) => { const next = { ...e, [id]: { ...e[id], pressed: down } }; refs.current.env = next; return next; }),
      live: () => liveState(),
    });
    bench.current = b; requestAnimationFrame(() => b.fit());
    return () => b.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => { bench.current?.setActive(active); if (active) requestAnimationFrame(() => bench.current?.fit()); }, [active]);

  function liveState() {
    const { nl: n, env: e } = refs.current, pins = rt.current?.pins || {};
    const powered = new Map(), leds = new Map(), envs = {};
    for (const p of n.parts) {
      powered.set(p.obj.id, p.powered); envs[p.obj.id] = envFor(e, p.obj);
      if (p.obj.type === 'led') leds.set(p.obj.id, p.powered && (p.io['+'] || []).some((g) => pins[g]?.mode === 'OUTPUT' && pins[g].value));
    }
    const comp = new Map(); for (const o of refs.current.layout.objects) { const s = circuit.part(o.id); if (s) comp.set(o.id, s); }
    // Parts the sketch drives straight from its pins: servo angle, RGB and 7-segment brightness (PWM counts).
    const duty = (gs) => Math.max(0, ...(gs || []).map((g) => { const s = pins[g]; return s?.mode === 'OUTPUT' ? (s.pwm != null ? s.pwm / 255 : s.value ? 1 : 0) : 0; }));
    const servos = new Map(), rgb = new Map(), seg = new Map();
    for (const p of n.parts) {
      const id = p.obj.id;
      if (p.obj.type === 'servo') { const s = (p.io.SIG || []).map((g) => pins[g]).find((q) => q?.mode === 'SERVO'); servos.set(id, p.powered && s ? s.servo : null); }
      if (p.obj.type === 'rgb') rgb.set(id, p.powered ? ['R', 'G', 'B'].map((k) => duty(p.io[k])) : [0, 0, 0]);
      if (p.obj.type === 'seg7') seg.set(id, [...'abcdefg'].map((k) => (p.powered ? duty(p.io[k]) : 0)));
    }
    for (const p of n.parts) if (p.obj.type === 'led') leds.set(p.obj.id, (comp.get(p.obj.id)?.I || 0) > 0.0005);
    return { pins, oled: oled.current, powered, leds, env: envs, circuit: comp, labels: refs.current.labels, board: circuit.board(), servos, rgb, seg };
  }

  /* ---------- what the sketch sees, read from the wires ---------- */
  const io = React.useMemo(() => ({
    digital: (g) => circuit.digital(g),
    analog: (g) => circuit.analog(g),
    echo(g) {
      const { nl: n, env: e } = refs.current;
      const p = n.parts.find((q) => q.obj.type === 'sonar' && q.io.ECHO?.includes(g));
      return p ? { distance: envFor(e, p.obj).distance, trig: p.io.TRIG || [], powered: p.powered } : null;
    },
    dht(g) {
      const { nl: n, env: e } = refs.current;
      const p = n.parts.find((q) => q.obj.type === 'dht' && q.io.DATA?.includes(g));
      return p ? { ...envFor(e, p.obj), powered: p.powered } : null;
    },
    i2c() {
      const { nl: n, layout: l } = refs.current, b = BOARDS[l.board];
      return n.parts.some((p) => p.obj.type === 'oled' && p.powered && p.io.SDA?.includes(b.i2c.sda) && p.io.SCL?.includes(b.i2c.scl));
    },
  }), [circuit]);

  const pushSerial = React.useCallback((text, kind = 'out', sketchBaud) => {
    const shown = kind === 'out' && sketchBaud && sketchBaud !== refs.current.monitorBaud ? garble(text) : text;
    setSerial((lines) => {
      const next = lines.slice(); const parts = shown.split('\n');
      parts.forEach((p, i) => {
        const last = next[next.length - 1];
        if (i === 0 && last && !last.done && (last.kind === kind || last.text === '')) next[next.length - 1] = { ...last, kind, text: last.text + p };
        else next.push({ text: p, kind, done: false, id: Math.random() });
        if (i < parts.length - 1) next[next.length - 1] = { ...next[next.length - 1], done: true };
      });
      return next.length > MAX_SERIAL ? next.slice(-MAX_SERIAL) : next;
    });
  }, []);
  pushSerialRef.current = pushSerial;

  const onShow = React.useCallback((bits, on) => {
    oled.current = { bits: bits.slice(), on };
    const c = oledCv.current; if (!c) return;
    const g = c.getContext('2d'); const img = g.createImageData(128, 64);
    for (let i = 0; i < bits.length; i++) { const v = on && bits[i]; img.data[i * 4] = v ? 232 : 4; img.data[i * 4 + 1] = v ? 244 : 6; img.data[i * 4 + 2] = v ? 255 : 8; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, []);

  const stop = React.useCallback((msg) => {
    rt.current?.stop(); rt.current = null; onShow(new Uint8Array(8192), false);
    setState((s) => ({ ...s, status: s.status === 'error' ? 'error' : 'idle', upload: 0 }));
    if (msg) pushSerial(`${msg}\n`, 'sys');
  }, [pushSerial, onShow]);

  const upload = async () => {
    if (circuit.board().shorted) { pushSerial('Upload failed: the board has no power. Remove the wire shorting a power pin to GND.\n', 'err'); return; }
    // Check the sketch first, in the student's own line numbers.
    const lint = lintSketch(code, [...SKETCH_NAMES, ...Object.keys(B.aliases || {})]);
    for (const w of lint.warnings) pushSerial(`Warning, line ${w.line}: ${w.msg}\n`, 'warn');
    if (lint.errors.length) {
      rt.current?.stop(); rt.current = null;
      pushSerial(`\nCompile failed: ${lint.errors.length} problem${lint.errors.length > 1 ? 's' : ''}.\n`, 'err');
      for (const e of lint.errors) pushSerial(`  Line ${e.line}: ${e.msg}\n`, 'err');
      const first = lint.errors[0], more = lint.errors.length - 1;
      setState({ status: 'error', error: `Line ${first.line}: ${first.msg}${more ? ` (and ${more} more in the serial monitor)` : ''}`, line: first.line, upload: 0, errLines: lint.errors.map((e) => e.line) });
      toast({ title: `Line ${first.line}`, description: first.msg, type: 'danger', timeout: 4000 });
      return;
    }
    rt.current?.stop(); rt.current = null;
    onShow(new Uint8Array(8192), false);
    setState({ status: 'uploading', error: '', line: null, upload: 0, errLines: [] });
    pushSerial(`\nCompiling for ${B.name}…\n`, 'sys');
    for (const p of [20, 48, 76, 100]) { await new Promise((r) => setTimeout(r, 130)); setState((s) => ({ ...s, upload: p })); }
    pushSerial(B.id === 'pico' ? 'Copying UF2 to RPI-RP2… done\n' : B.family === 'esp32' ? 'Writing at 0x00010000… (100 %)\nHard resetting via RTS pin…\n' : 'avrdude: writing flash… done. Thank you.\n', 'sys');
    const runtime = createRuntime({ board: B, io, onSerial: pushSerial, onShow });
    rt.current = runtime; started.current = performance.now();
    setState({ status: 'running', error: '', line: null, upload: 100, errLines: [] });
    try { await runtime.run(code); }
    catch (err) {
      if (rt.current !== runtime) return;
      const f = friendlyError(err, code), text = typeof f === 'string' ? f : f.msg;
      const line = typeof f === 'object' ? f.line : err instanceof SyntaxError ? null : errorLine(err);
      const msg = line ? `Line ${line}: ${text}` : text[0].toUpperCase() + text.slice(1);
      pushSerial(`${msg}\n`, 'err'); setState({ status: 'error', error: msg, line, upload: 0, errLines: line ? [line] : [] });
      toast({ title: 'Sketch stopped', description: msg, type: 'danger', timeout: 4000 }); rt.current = null;
    }
  };

  // An example brings its own circuit, built for the board in use, so the code and the bench always match.
  // It replaces the bench in one undoable step.
  const openExample = (key, boardId = layout.board) => {
    const ex = SKETCHES[key];
    let l = defaultLayout(boardId, ex.parts || []);
    if (ex.demo) l = componentDemo(l);
    stop(); circuit.reset(); setEnv({}); setLesson(null);
    commit(l);
    const filled = fillSketch(ex.code, sketchPins(l, netlist(l)));
    setCode(filled); setLastExample({ key, filled });
    const names = l.objects.filter((o) => o.kind === 'part' && o.type !== 'rail').map((o) => PARTS[o.type].name);
    pushSerial(`Opened example: ${ex.name}. Bench set up with ${names.length ? [...new Set(names)].join(', ') : `just the ${BOARDS[boardId].name}`}.\n`, 'sys');
    requestAnimationFrame(() => bench.current?.fit());
  };

  const changeBoard = (id) => {
    if (id === layout.board) return;
    pushSerial(`Board changed to ${BOARDS[id].name}.\n`, 'sys');
    // An untouched example moves to the new board with its circuit and the new board's pins.
    if (lastExample.filled && code === lastExample.filled) { openExample(lastExample.key, id); return; }
    stop();
    const next = defaultLayout(id); commit(next); setEnv({}); circuit.reset();
    pushSerial('Wiring reset to its default pins.\n', 'sys');
    requestAnimationFrame(() => bench.current?.fit());
  };

  const addPart = (type) => {
    if (type === 'rail') {
      const bottom = Math.max(...layout.objects.map((o) => o.y + (o.type === 'rail' ? 2 : PARTS[o.type]?.h ?? BOARDS[o.type]?.h ?? 0)));
      const o = { id: newId('rail'), kind: 'part', type: 'rail', x: 0, y: bottom + 4, props: { holes: 30 } };
      commit({ ...layout, objects: [...layout.objects, o] });
      bench.current?.select({ kind: 'obj', id: o.id });
      pushSerial('Added a power rail. Wire a power pin to its + row and GND to its − row to use it. Drag its right end to change the length.\n', 'sys');
      requestAnimationFrame(() => bench.current?.fit());
      return;
    }
    const P = PARTS[type], isComp = COMPONENTS.includes(type);
    const row = layout.objects.filter((o) => o.kind === 'part' && o.type !== 'rail' && COMPONENTS.includes(o.type) === isComp);
    const x = row.length ? Math.max(...row.map((o) => o.x + PARTS[o.type].w)) + 3 : 1;
    const o = { id: newId(type), kind: 'part', type, x, y: isComp ? 19 + (P.axial ? 1 : 0) : 14 - 3 - P.h, rot: 0 };
    commit({ ...layout, objects: [...layout.objects, o] });
    bench.current?.select({ kind: 'obj', id: o.id });
    pushSerial(`Added ${P.name}. Drag from its pins to wire it up.\n`, 'sys');
  };

  // Group editing: everything selected on the bench (box select, Shift+click, a paste) moves, copies and
  // deletes together. The board itself can be moved but is never deleted or copied.
  const removeSelected = React.useCallback(() => {
    const g = bench.current?.group, L = refs.current.layout; if (!g) return;
    const kill = new Set(g.objs.filter((id) => L.objects.find((o) => o.id === id)?.kind !== 'board'));
    const owner = (key) => key.split(':')[0];
    const wires = L.wires.filter((w) => !g.wires.includes(w.id) && !kill.has(owner(w.a)) && !kill.has(owner(w.b)));
    if (!kill.size && wires.length === L.wires.length) return;
    commit({ ...L, objects: L.objects.filter((o) => !kill.has(o.id)), wires });
    bench.current.select(null);
  }, [commit]);
  const clip = React.useRef(null);
  const copySelected = React.useCallback(() => {
    const g = bench.current?.group, L = refs.current.layout; if (!g) return;
    const objs = L.objects.filter((o) => g.objs.includes(o.id) && o.kind !== 'board');
    if (!objs.length) return;
    const ids = new Set(objs.map((o) => o.id)), owner = (key) => key.split(':')[0];
    // Wires between copied parts come along; wires to anything else stay behind.
    clip.current = { objs: objs.map((o) => ({ ...o, props: o.props && { ...o.props } })), wires: L.wires.filter((w) => ids.has(owner(w.a)) && ids.has(owner(w.b))), n: 0 };
    pushSerial(`Copied ${objs.length} ${objs.length > 1 ? 'parts' : 'part'}.\n`, 'sys');
  }, [pushSerial]);
  const pasteClip = React.useCallback(() => {
    const c = clip.current; if (!c) return;
    const off = 3 * ++c.n, map = new Map(), L = refs.current.layout;
    const objs = c.objs.map((o) => { const id = newId(o.type); map.set(o.id, id); return { ...o, id, x: o.x + off, y: o.y + off, props: o.props && { ...o.props } }; });
    const re = (key) => { const [oid, pin] = key.split(':'); return `${map.get(oid)}:${pin}`; };
    const wires = c.wires.map((w) => ({ id: newId('w'), a: re(w.a), b: re(w.b) }));
    commit({ ...L, objects: [...L.objects, ...objs], wires: [...L.wires, ...wires] });
    bench.current?.setGroup(objs.map((o) => o.id), wires.map((w) => w.id));
    pushSerial(`Pasted ${objs.length} ${objs.length > 1 ? 'parts' : 'part'}. Wire them to the board to use them.\n`, 'sys');
  }, [commit, pushSerial]);
  const selectAll = () => { const L = refs.current.layout; bench.current?.setGroup(L.objects.filter((o) => o.kind !== 'board').map((o) => o.id), L.wires.map((w) => w.id)); };
  // Clear board: everything except the board goes, as one undoable step.
  const clearBoard = () => {
    const L = refs.current.layout;
    if (L.objects.length === 1 && !L.wires.length) return;
    stop(); circuit.reset(); setEnv({}); setLesson(null);
    commit({ ...L, objects: L.objects.filter((o) => o.kind === 'board'), wires: [] });
    bench.current?.select(null);
    pushSerial('Board cleared. Ctrl+Z brings everything back.\n', 'sys');
  };

  // Project files: the bench and the code together, so work can be handed in or carried home.
  const saveFile = () => {
    saveProject('maker', { layout: refs.current.layout, code });
    pushSerial('Saved the bench and the code to a project file.\n', 'sys');
  };
  const openFile = () => openProject('maker').then((doc) => {
    const l = validLayout(doc.layout);
    if (!l) throw new Error('The circuit in that project is damaged or uses parts this version does not have.');
    stop(); circuit.reset(); setEnv({}); setLesson(null);
    commit(l); bench.current?.select(null);
    if (typeof doc.code === 'string') { setCode(doc.code.slice(0, 200000)); setLastExample({ key: null, filled: null }); }
    pushSerial(`Opened ${doc.fileName}. Ctrl+Z brings back the bench you had.\n`, 'sys');
    requestAnimationFrame(() => bench.current?.fit());
  }).catch((err) => toast({ title: 'Could not open the file', description: err.message, type: 'danger', timeout: 4000 }));

  // Failure lessons: load the mistake on a fresh Uno, then offer the fix. Both steps are undoable.
  const openLesson = (id) => {
    const l = LESSONS.find((x) => x.id === id); if (!l) return;
    stop(); circuit.reset(); setEnv({});
    commit(l.broken()); setLesson(l.id);
    if (l.code) setCode(l.code);
    pushSerial(`\nLesson: ${l.title}. ${l.try}\n`, 'sys');
    requestAnimationFrame(() => bench.current?.fit(!l.boardLesson));
  };
  const applyFix = () => {
    const l = LESSONS.find((x) => x.id === lesson); if (!l) return;
    commit(l.fixed()); circuit.reset();
    pushSerial(`Fix applied: ${l.fix}\n`, 'sys');
    requestAnimationFrame(() => bench.current?.fit(!l.boardLesson));
  };

  keys.current = { copy: copySelected, paste: pasteClip, all: selectAll };

  const rotateSelected = () => {
    const s = bench.current?.selection, L = refs.current.layout; if (s?.kind !== 'obj') return;
    const o = L.objects.find((q) => q.id === s.id); if (!o || !PARTS[o.type]?.axial) return;
    commit({ ...L, objects: L.objects.map((q) => (q.id === o.id ? { ...q, rot: ((q.rot || 0) + 1) % 2 } : q)) });
  };
  const setProps = (id, patch) => commit((L) => ({ ...L, objects: L.objects.map((q) => (q.id === id ? { ...q, props: { ...q.props, ...patch } } : q)) }));

  const onKeyDown = (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); upload(); return; }
    if (ev.key === 'Tab') {
      ev.preventDefault(); const t = ev.currentTarget, s = t.selectionStart, e = t.selectionEnd;
      setCode(code.slice(0, s) + '  ' + code.slice(e));
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    }
  };

  const setPartEnv = (id, patch) => setEnv((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  // Clicking or scrolling on a selected part on the bench, the same as its controls in the Parts panel.
  const interactRef = React.useRef(() => {});
  interactRef.current = (o, kind, dir = 0, shift = false) => {
    const e = envFor(refs.current.env, o), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (kind === 'click') {
      if (o.type === 'toggle') setPartEnv(o.id, { on: !e.on });
      else if (o.type === 'pir') wave(o.id);
      else if (o.type === 'ir') setPartEnv(o.id, { obstacle: !e.obstacle });
      return;
    }
    // Each scroll notch builds on the last one, even when several arrive before the next render.
    const bump = (key, step, lo, hi) => setEnv((all) => {
      const cur = envFor(all, o)[key], next = { ...all, [o.id]: { ...all[o.id], [key]: clamp(cur + dir * step, lo, hi) } };
      refs.current.env = next; return next;
    });
    if (o.type === 'pot') bump('pos', 2, 0, 100);
    else if (o.type === 'ldr') bump('light', 2, 0, 100);
    else if (o.type === 'soil') bump('moisture', 2, 0, 100);
    else if (o.type === 'sonar') bump('distance', 5, 0, 450);
    else if (o.type === 'dht') { if (shift) bump('hum', 1, 20, 90); else bump('temp', 1, 0, 50); }
  };
  const wave = (id) => {
    clearTimeout(timers.current[id]); setPartEnv(id, { motion: true });
    timers.current[id] = setTimeout(() => setEnv((e) => ({ ...e, [id]: { ...e[id], motion: !!e[id]?.hold } })), 3000);
  };

  const running = state.status === 'running';
  const uptime = running ? (performance.now() - started.current) / 1000 : 0;
  const lines = code.split('\n').length;
  const pinLabel = (g) => B.pins.find((p) => p.kind === 'gpio' && p.gpio === g)?.label ?? String(g);
  const parts = nl.parts;
  const hasOled = parts.some((p) => p.obj.type === 'oled');
  const selObj = selection?.kind === 'obj' ? layout.objects.find((o) => o.id === selection.id) : null;
  const benchGroup = bench.current?.group, groupSize = benchGroup ? benchGroup.objs.length + benchGroup.wires.length : 0;

  return (
    <div className="ide" hidden={!active}>
      <div className="bar ide__bar">
        <div className="run">
          <Select className="ide__boardsel" items={BOARD_ITEMS} value={layout.board} onValueChange={changeBoard} aria-label="Board" />
          <Select className="run__examples" items={SKETCH_ITEMS} value={null} placeholder="Open example sketch" onValueChange={(v) => v && openExample(v)} />
          <Tooltip content="Ctrl + Enter"><Button size="sm" variant="primary" onClick={upload} loading={state.status === 'uploading'}>Upload &amp; run</Button></Tooltip>
          <Button size="sm" disabled={!running} onClick={() => stop('Sketch stopped.')}>Stop</Button>
          <Button size="sm" variant="ghost" disabled={!running} onClick={upload}>Reset board</Button>
          <Button size="sm" variant="ghost" onClick={saveFile}>Save file</Button>
          <Button size="sm" variant="ghost" onClick={openFile}>Open file</Button>
        </div>
        <div className="run">
          <Status tone={running ? 'ok' : state.status === 'error' ? 'danger' : state.status === 'uploading' ? 'warn' : 'idle'} pulse={running}>
            {running ? 'Running' : state.status === 'error' ? 'Error' : state.status === 'uploading' ? 'Uploading' : 'Idle'}
          </Status>
          <Readout label="Uptime" value={uptime.toFixed(1)} unit="s" size="sm" />
          <Readout label="ADC" value={`0–${B.adcMax}`} size="sm" />
        </div>
      </div>

      <div className="ide__grid">
        <Panel title="Sketch" meta={`main.ino / ${lines} LINES`} className="ide__code" enterDelay={60}>
          <div className="editor">
            <pre className="editor__gutter" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} data-err={state.errLines?.includes(i + 1) ? '' : undefined}>{i + 1}{'\n'}</span>)}</pre>
            <textarea ref={editorRef} className="editor__text" value={code} spellCheck={false} aria-label="Sketch code"
              onChange={(e) => setCode(e.target.value)} onKeyDown={onKeyDown}
              onScroll={(e) => { e.currentTarget.previousSibling.scrollTop = e.currentTarget.scrollTop; }} />
          </div>
          {state.status === 'uploading' && <Progress label="Uploading" value={state.upload} cells={20} gap={2} hideScale />}
          {state.error && (state.line
            ? <button type="button" className="editor__err editor__errlink" onClick={() => goToLine(state.line)} title="Show this line">{state.error}</button>
            : <p className="editor__err">{state.error}</p>)}
        </Panel>

        <Panel title="Wiring bench" meta={`${B.name.toUpperCase()} / ${layout.wires.length} WIRES`} className="ide__bench" enterDelay={140}>
          <div className="wb">
            {/* One row: parts live in menus so the bench keeps its height on smaller screens. */}
            <div className="wb__tools" role="toolbar" aria-label="Bench tools">
              <Menu.Root>
                <Menu.Trigger render={<Button size="sm" />}>+ Module</Menu.Trigger>
                <Menu.Content align="start">
                  {MODULES.map((t) => <Menu.Item key={t} onClick={() => addPart(t)} hint={PARTS[t].model}>{PARTS[t].name}</Menu.Item>)}
                </Menu.Content>
              </Menu.Root>
              <Menu.Root>
                <Menu.Trigger render={<Button size="sm" />}>+ Component</Menu.Trigger>
                <Menu.Content align="start">
                  {COMPONENTS.map((t) => <Menu.Item key={t} onClick={() => addPart(t)} hint={PARTS[t].model}>{PARTS[t].name}</Menu.Item>)}
                  <Menu.Separator />
                  <Menu.Item onClick={() => addPart('rail')} hint="+ / −">Power rail</Menu.Item>
                </Menu.Content>
              </Menu.Root>
              <Select className="wb__lessons" items={LESSON_ITEMS} value={null} placeholder="Lessons: what goes wrong when…" onValueChange={(v) => v && openLesson(v)} aria-label="Load a failure lesson" />
            </div>
            <div className="wb__stage">
              <canvas ref={benchCv} className="wb__cv" tabIndex={0} aria-label="Wiring bench. Drag from a pin to another pin to add a jumper wire. Drag parts to move them, drag empty space to pan, scroll to zoom."
                onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); } if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey) rotateSelected(); if (e.key === 'Escape') bench.current?.select(null); }} />
              <p className="stage__hint mh-micro">{selection ? `${USE_HINT[selObj?.type] ? `${USE_HINT[selObj.type]} · ` : ''}DEL removes the selected ${selection.kind === 'wire' ? 'wire' : 'part'}${selObj && PARTS[selObj.type]?.axial ? ' · R rotates it' : ''}` : 'Drag pin to pin to add a wire. Click a wire, then drag its end handle to move it to another pin. Drag empty space to pan, Shift+drag to box-select. Ctrl+Z undoes. Scroll to zoom.'}</p>
              <div className="stage__zoom">
                {selObj && PARTS[selObj.type]?.axial && <Button size="sm" variant="ghost" onClick={rotateSelected}>Rotate</Button>}
                {groupSize > 0 && !(groupSize === 1 && selObj?.kind === 'board') && <Button size="sm" variant="danger" onClick={removeSelected}>{groupSize > 1 ? `Delete ${groupSize}` : 'Delete'}</Button>}
                <Button size="sm" variant="ghost" disabled={!groupSize} title="Ctrl + C" onClick={copySelected}>Copy</Button>
                <Button size="sm" variant="ghost" disabled={!clip.current} title="Ctrl + V" onClick={pasteClip}>Paste</Button>
                <Button size="sm" variant="ghost" disabled={!hist.current.past.length} title="Ctrl + Z" onClick={() => travel(true)}>Undo</Button>
                <Button size="sm" variant="ghost" disabled={!hist.current.future.length} title="Ctrl + Y" onClick={() => travel(false)}>Redo</Button>
                <Button size="sm" variant="ghost" onClick={clearBoard}>Clear board</Button>
                <Button size="sm" variant="ghost" onClick={() => { changeBoardReset(); }}>Reset wiring</Button>
                <span className="zoomgroup">
                <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => bench.current.zoomBy(0.8)}>−</Button>
                <Button size="sm" variant="ghost" onClick={() => bench.current.fit()}>Fit</Button>
                <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => bench.current.zoomBy(1.25)}>+</Button>
                </span>
              </div>
            </div>
            {nl.shorts && <p className="editor__err">Short circuit: a power pin and GND are wired together. Every module is switched off until you remove that wire.</p>}
          </div>
        </Panel>

        <div className="ide__side">
          {lesson && <LessonCard lesson={LESSONS.find((x) => x.id === lesson)} onFix={applyFix} onClose={() => setLesson(null)} />}
          <Panel title="Parts" meta={`${parts.length} ON BENCH`} className="ide__sensors" enterDelay={220}>
            <div className="sensors">
              {layout.objects.filter((o) => o.type === 'rail').map((o, i) => (
                <RailRow key={o.id} index={i + 1} rail={o} nl={nl} pinLabel={pinLabel} selected={selObj?.id === o.id}
                  onSelect={() => bench.current?.select({ kind: 'obj', id: o.id })}
                  onLength={(n) => commit((L) => resizeRail(L, o.id, n))} />
              ))}
              <BoardRow board={B} state={circuit.board()} onRepair={() => { circuit.repairBoard(); pushSerial(`[sim] ${B.name} replaced with a fresh board.\n`, 'sys'); }} />
              {parts.map((p) => (
                <PartRow key={p.obj.id} part={p} env={envFor(env, p.obj)} pinLabel={pinLabel} selected={selObj?.id === p.obj.id}
                  label={labels.get(p.obj.id)} state={circuit.part(p.obj.id)} onRepair={() => circuit.repair(p.obj.id)} setProps={(patch) => setProps(p.obj.id, patch)}
                  onSelect={() => bench.current?.select({ kind: 'obj', id: p.obj.id })}
                  set={(patch) => setPartEnv(p.obj.id, patch)} wave={() => wave(p.obj.id)} />
              ))}
              {!parts.length && <p className="mh-micro">No parts on the bench. Add one from the bench toolbar.</p>}
            </div>
          </Panel>
          {hasOled && (
            <Panel title="Display" meta={`SSD1306 / SDA ${pinLabel(B.i2c.sda)} SCL ${pinLabel(B.i2c.scl)}`} enterDelay={260}>
              <div className="oled"><canvas ref={oledCv} width={128} height={64} className="oled__cv" aria-label="OLED display output" /></div>
            </Panel>
          )}
          <SerialMonitor lines={serial} baud={monitorBaud} setBaud={setMonitorBaud} sketchBaud={rt.current?.baud}
            onSend={(t) => { rt.current?.send(t + '\n'); pushSerial(`> ${t}\n`, 'in'); }} onClear={() => setSerial([])} />
        </div>
      </div>
    </div>
  );

  function changeBoardReset() {
    const next = defaultLayout(layout.board); commit(next); setEnv({}); circuit.reset();
    pushSerial('Wiring reset to the default pins.\n', 'sys'); requestAnimationFrame(() => bench.current?.fit());
  }
}

const COLORS = Object.keys(LEDC).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));
const mA = (i) => `${(Math.abs(i || 0) * 1000).toFixed(1)} mA`;

function PartRow({ part, env, pinLabel, selected, label, state, onRepair, setProps, onSelect, set, wave }) {
  const { obj, powered, volts, io } = part, P = PARTS[obj.type], isModule = MODULES.includes(obj.type), pr = propsOf(obj);
  const links = Object.entries(io);
  const s = state || {};
  return (
    <section className="sensor" data-selected={selected ? '' : undefined}>
      <div className="row row--between">
        <button type="button" className="sensor__name" onClick={onSelect}>{isModule ? P.name : `${label} · ${P.name}`}<span className="mh-micro"> {P.model}</span></button>
        {s.failed ? <Tag tone="danger">FAILED</Tag> : isModule && obj.type !== 'led' ? (powered ? <Tag tone="ok">{volts} V</Tag> : <Tag tone="danger">NO POWER</Tag>) : null}
      </div>
      {isModule && (
        <div className="sensor__links mh-micro">
          {links.map(([name, gs]) => <span key={name} data-bad={gs.length ? undefined : ''}>{name} → {gs.length ? gs.map(pinLabel).join(', ') : 'not wired'}</span>)}
        </div>
      )}
      {obj.type === 'pir' && <div className="row"><Button size="sm" onClick={wave}>Wave hand</Button><Switch checked={!!env.hold} onCheckedChange={(v) => set({ hold: v, motion: v })}>Hold</Switch><Tag tone="idle">{env.motion ? 'MOTION' : 'STILL'}</Tag></div>}
      {obj.type === 'sonar' && <Slider label={`Object distance · ${env.distance} cm`} thumbLabel="Distance in cm" min={0} max={450} value={env.distance} hideScale onValueChange={(v) => set({ distance: v })} />}
      {obj.type === 'soil' && <Slider label={`Soil wetness · ${env.moisture}%`} thumbLabel="Soil wetness" min={0} max={100} value={env.moisture} hideScale onValueChange={(v) => set({ moisture: v })} />}
      {obj.type === 'ldr' && <Slider label={`Ambient light · ${env.light}%`} thumbLabel="Ambient light" min={0} max={100} value={env.light} hideScale onValueChange={(v) => set({ light: v })} />}
      {obj.type === 'dht' && <>
        <Slider label={`Temperature · ${env.temp} °C`} thumbLabel="Temperature" min={0} max={50} value={env.temp} hideScale onValueChange={(v) => set({ temp: v })} />
        <Slider label={`Humidity · ${env.hum}%`} thumbLabel="Humidity" min={20} max={90} value={env.hum} hideScale onValueChange={(v) => set({ hum: v })} />
      </>}
      {obj.type === 'relay' && <span className="mh-micro">{s.on ? 'ON: COM joined to NO' : 'OFF: COM joined to NC'}. Drive IN HIGH to switch it.</span>}
      {obj.type === 'lamp' && <span className="mh-micro">{Math.abs(s.I || 0) > 0.05 ? `LIT · ${Math.round(Math.abs(s.I) * 1000)} mA` : 'DARK'} · its own 12 V battery, apart from the board</span>}
      {obj.type === 'ir' && <Switch checked={!!env.obstacle} onCheckedChange={(v) => set({ obstacle: v })}>Object in front</Switch>}
      {obj.type === 'resistor' && <div className="row row--between"><Select items={RESISTORS.map((r) => ({ value: r, label: fmtR(r) }))} value={pr.R} onValueChange={(v) => setProps({ R: v })} aria-label="Resistance" /><span className="mh-micro">{mA(s.I)} · {((s.P || 0) * 1000).toFixed(0)} mW</span></div>}
      {obj.type === 'ledc' && <div className="row row--between"><Select items={COLORS} value={pr.color} onValueChange={(v) => setProps({ color: v })} aria-label="LED colour" /><span className="mh-micro">{mA(s.I)}</span></div>}
      {obj.type === 'diode' && <span className="mh-micro">{mA(s.I)} · {(s.Vd || 0).toFixed(2)} V</span>}
      {obj.type === 'cap' && <div className="row row--between"><Select items={CAPS.map((c) => ({ value: c, label: `${c} µF` }))} value={pr.C} onValueChange={(v) => setProps({ C: v })} aria-label="Capacitance" /><Select items={CAP_VOLTS.map((v) => ({ value: v, label: `${v} V` }))} value={pr.Vmax} onValueChange={(v) => setProps({ Vmax: v })} aria-label="Voltage rating" /><span className="mh-micro">{(s.vc || 0).toFixed(2)} V</span></div>}
      {obj.type === 'npn' && <span className="mh-micro">IC {mA(s.Ic)} · IB {mA(s.Ib)} · VCE {(s.Vd || 0).toFixed(2)} V</span>}
      {obj.type === 'button' && <Button size="sm" onPointerDown={() => set({ pressed: true })} onPointerUp={() => set({ pressed: false })} onPointerLeave={() => env.pressed && set({ pressed: false })}>{env.pressed ? 'Pressed' : 'Hold to press'}</Button>}
      {obj.type === 'toggle' && <Switch checked={!!env.on} onCheckedChange={(v) => set({ on: v })}>Switch on</Switch>}
      {obj.type === 'pot' && <Slider label={`Knob · ${env.pos}%`} thumbLabel="Potentiometer position" min={0} max={100} value={env.pos} hideScale onValueChange={(v) => set({ pos: v })} />}
      {obj.type === 'buzzer' && <span className="mh-micro">{(s.I || 0) > 0.005 ? 'BEEPING' : 'SILENT'} · {mA(s.I)}</span>}
      {s.failed && <Button size="sm" onClick={onRepair}>Repair</Button>}
    </section>
  );
}

function LessonCard({ lesson, onFix, onClose }) {
  return (
    <Panel title="Lesson" meta="WHAT GOES WRONG" className="lesson" enterDelay={0}>
      <div className="stack">
        <p className="lesson__title">{lesson.title}</p>
        <dl className="lesson__list">
          <dt>Try</dt><dd>{lesson.try}</dd>
          <dt>What happens</dt><dd>{lesson.happens}</dd>
          <dt>Why</dt><dd>{lesson.why}</dd>
          <dt>The fix</dt><dd>{lesson.fix}</dd>
        </dl>
        <div className="row">
          <Button size="sm" variant="primary" onClick={onFix}>Apply the fix</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Panel>
  );
}

function RailRow({ index, rail, nl, pinLabel, selected, onSelect, onLength }) {
  // What feeds each row: the board pins on the same net as the rail's first hole.
  const feed = (sign) => nl.netOf(`${rail.id}:${sign}0`).filter((p) => p.obj.kind === 'board').map((p) => p.label || p.name);
  const plus = [...new Set(feed('+'))], minus = [...new Set(feed('−'))];
  const n = railHoles(rail), items = [...new Set([...RAIL_LENGTHS, n])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v} holes` }));
  return (
    <section className="sensor" data-selected={selected ? '' : undefined}>
      <div className="row row--between">
        <button type="button" className="sensor__name" onClick={onSelect}>Power rail {index}<span className="mh-micro"> + / −</span></button>
        {plus.length && minus.length ? <Tag tone="ok">POWERED</Tag> : <Tag tone="warn">NOT POWERED</Tag>}
      </div>
      <div className="sensor__links mh-micro">
        <span data-bad={plus.length ? undefined : ''}>+ → {plus.length ? plus.join(', ') : 'not wired'}</span>
        <span data-bad={minus.length ? undefined : ''}>− → {minus.length ? minus.join(', ') : 'not wired'}</span>
      </div>
      <Select items={items} value={n} onValueChange={onLength} aria-label="Rail length" />
    </section>
  );
}

function BoardRow({ board, state, onRepair }) {
  const dead = state.dead;
  return (
    <section className="sensor">
      <div className="row row--between">
        <span className="sensor__name">{board.name}<span className="mh-micro"> {board.chip}</span></span>
        {state.shorted ? <Tag tone="danger">SHORT</Tag> : dead.length ? <Tag tone="warn">DAMAGED</Tag> : <Tag tone="ok">OK</Tag>}
      </div>
      {state.shorted && <span className="mh-micro sensor__warn">Power is shorted to GND. The board is off until you remove that wire (Ctrl+Z works).</span>}
      {dead.length > 0 && <div className="row row--between"><span className="mh-micro sensor__warn">Dead pins: {dead.map(board.code).join(', ')}</span><Button size="sm" onClick={onRepair}>Replace board</Button></div>}
    </section>
  );
}

function SerialMonitor({ lines, baud, setBaud, sketchBaud, onSend, onClear }) {
  const box = React.useRef(null); const [text, setText] = React.useState('');
  React.useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [lines]);
  const mismatch = sketchBaud && sketchBaud !== baud;
  return (
    <Panel title="Serial monitor" meta={mismatch ? `SKETCH ${sketchBaud} / MISMATCH` : 'USB / COM3'} className="ide__serial" enterDelay={300}>
      <div className="serial">
        <div className="serial__out" ref={box} role="log" aria-live="polite">
          {lines.filter((l) => l.done || l.text).map((l) => <div key={l.id} className={`serial__line serial__line--${l.kind}`}>{l.text || ' '}</div>)}
        </div>
        <form className="serial__in" onSubmit={(e) => { e.preventDefault(); if (text) { onSend(text); setText(''); } }}>
          <input className="serial__field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Send to the board" aria-label="Serial input" />
          <Button size="sm" type="submit">Send</Button>
        </form>
        <div className="row row--between">
          <Select className="serial__baud" items={BAUDS} value={baud} onValueChange={setBaud} aria-label="Monitor baud rate" />
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </div>
    </Panel>
  );
}
