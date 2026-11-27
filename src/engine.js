// Circuit Bench simulator, ported from AmeerBashaK/circuit-bench and restyled for a monochrome HUD.
// Nodal analysis with Newton-Raphson for diodes, LEDs and transistors, backward Euler for capacitors.

import { LEDC, VT, QVC, dcalc, dlimit, dpar as diodeParams, pnj, qcalc } from './models.js';

export { LEDC };
export const G = 20, LW = 900, LH = 540;
const SAVE = 'circuit-bench-hud-v1';
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const TYPES = {
  wire: { label: 'Wire', min: 1, def: () => ({}) },
  resistor: { label: 'Resistor', pre: 'R', min: 2, def: () => ({ R: 470, P: 0.25 }) },
  capacitor: { label: 'Capacitor', pre: 'C', min: 2, def: () => ({ C: 100, Vmax: 16, polar: true }) },
  diode: { label: 'Diode', pre: 'D', min: 2, def: () => ({ Imax: 1 }) },
  led: { label: 'LED', pre: 'LED', min: 2, def: () => ({ color: 'red', Imax: 0.03 }) },
  bjt: { label: 'Transistor', pre: 'Q', def: () => ({ pnp: false, beta: 100, Pmax: 0.625 }) },
  dc: { label: 'DC source', pre: 'V', min: 2, def: () => ({ V: 9, r: 0.2 }) },
  ac: { label: 'AC source', pre: 'V', min: 2, def: () => ({ V: 10, f: 2, r: 0.2 }) },
  switch: { label: 'Switch', pre: 'S', min: 2, def: () => ({ closed: true }) },
  button: { label: 'Push button', pre: 'PB', min: 2, def: () => ({ pressed: false }) },
};
export const TWO = ['wire', 'resistor', 'capacitor', 'diode', 'led', 'dc', 'ac', 'switch', 'button'];
export const FIELDS = {
  resistor: [['R', 'Resistance (Ω)', 'num'], ['P', 'Power rating', 'sel', [[0.125, '0.125 W'], [0.25, '0.25 W'], [0.5, '0.5 W'], [1, '1 W'], [2, '2 W'], [5, '5 W']]]],
  capacitor: [['C', 'Capacitance (µF)', 'num'], ['Vmax', 'Voltage rating', 'sel', [[6.3, '6.3 V'], [10, '10 V'], [16, '16 V'], [25, '25 V'], [50, '50 V'], [100, '100 V']]], ['polar', 'Polarized', 'chk']],
  diode: [['Imax', 'Max current', 'sel', [[0.2, '200 mA / 1N4148'], [1, '1 A / 1N4001'], [3, '3 A / 1N5401']]]],
  led: [['color', 'Colour', 'sel', [['red', 'Red / 1.8 V'], ['yellow', 'Yellow / 2.0 V'], ['green', 'Green / 2.2 V'], ['blue', 'Blue / 3.0 V'], ['white', 'White / 3.1 V']]], ['Imax', 'Max current', 'sel', [[0.02, '20 mA'], [0.03, '30 mA'], [0.05, '50 mA']]]],
  bjt: [['pnp', 'Type', 'sel', [[false, 'NPN'], [true, 'PNP']]], ['beta', 'Current gain (β)', 'num'], ['Pmax', 'Power rating', 'sel', [[0.3, '0.3 W'], [0.625, '0.625 W / 2N2222'], [1.5, '1.5 W']]]],
  dc: [['V', 'Voltage (V)', 'num'], ['r', 'Internal resistance (Ω)', 'num']],
  ac: [['V', 'Peak voltage (V)', 'num'], ['f', 'Frequency (Hz)', 'num'], ['r', 'Internal resistance (Ω)', 'num']],
  switch: [['closed', 'Closed', 'chk']],
};
export const TOOLS = [
  ['select', 'Select', 'Q'], ['delete', 'Delete', 'X'], null,
  ['wire', 'Wire', '1'], ['resistor', 'Resistor', '2'], ['capacitor', 'Capacitor', '3'], ['diode', 'Diode', '4'],
  ['led', 'LED', '5'], ['bjt', 'Transistor', '6'], ['switch', 'Switch', '7'], ['button', 'Push button', 'B'], null,
  ['dc', 'DC source', '8'], ['ac', 'AC source', '9'],
];

/* ---------- formatting ---------- */
export const num = (x) => String(+(+x).toPrecision(3));
export const fR = (R) => (R >= 1e6 ? num(R / 1e6) + ' MΩ' : R >= 1e3 ? num(R / 1e3) + ' kΩ' : num(R) + ' Ω');
export function fA(I) { const a = Math.abs(I); if (a >= 1) return I.toFixed(2) + ' A'; if (a >= 1e-3) return (I * 1e3).toFixed(1) + ' mA'; if (a >= 1e-6) return (I * 1e6).toFixed(0) + ' µA'; return '0 mA'; }
export function fW(P) { const a = Math.abs(P); return a >= 1 ? P.toFixed(2) + ' W' : (P * 1e3).toFixed(0) + ' mW'; }
export const fV = (v) => v.toFixed(2) + ' V';
export function valueText(e) {
  const p = e.props;
  switch (e.type) {
    case 'resistor': return fR(p.R);
    case 'capacitor': return num(p.C) + ' µF' + (p.polar ? ' ' + p.Vmax + ' V' : '');
    case 'led': return p.color;
    case 'dc': return num(p.V) + ' V';
    case 'ac': return num(p.V) + ' V ' + num(p.f) + ' Hz';
    case 'switch': return p.closed ? 'closed' : 'open';
    case 'button': return p.pressed ? 'pressed' : 'released';
    case 'bjt': return p.pnp ? 'PNP' : 'NPN';
  }
  return '';
}
export const partV = (e) => (e.type === 'bjt' ? e.Vce || 0 : e.type === 'capacitor' ? e.vc : e.Vd || 0);
export const partI = (e) => (e.type === 'bjt' ? e.Ic || 0 : e.I || 0);
export const health = (e) => (e.failed ? 0 : Math.max(0, Math.round(100 * (1 - e.heat))));

const P = (x, y) => ({ x, y });
export const EXAMPLES = {
  series: { name: 'LED and capacitor in series', build(add) {
    add('dc', P(4, 6), P(4, 18)); add('switch', P(4, 6), P(10, 6), { closed: false }); add('capacitor', P(10, 6), P(16, 6), { C: 2200, Vmax: 16 });
    add('resistor', P(16, 6), P(24, 6)); add('wire', P(24, 6), P(32, 6)); add('led', P(32, 6), P(32, 18)); add('wire', P(32, 18), P(4, 18)); } },
  parallel: { name: 'Capacitor keeps an LED lit', build(add) {
    add('dc', P(4, 6), P(4, 18)); add('switch', P(4, 6), P(12, 6), { closed: false }); add('wire', P(12, 6), P(24, 6));
    add('capacitor', P(12, 6), P(12, 18), { C: 2200, Vmax: 16 }); add('resistor', P(24, 6), P(24, 12)); add('led', P(24, 12), P(24, 18)); add('wire', P(24, 18), P(4, 18)); } },
  nores: { name: 'LED with no resistor', build(add) {
    add('dc', P(4, 6), P(4, 18)); add('switch', P(4, 6), P(12, 6), { closed: false }); add('wire', P(12, 6), P(22, 6)); add('led', P(22, 6), P(22, 18)); add('wire', P(22, 18), P(4, 18)); } },
  revcap: { name: 'Capacitor wired backwards', build(add) {
    add('dc', P(4, 6), P(4, 18)); add('switch', P(4, 6), P(10, 6), { closed: false }); add('capacitor', P(16, 6), P(10, 6), { C: 100, Vmax: 16 });
    add('resistor', P(16, 6), P(24, 6), { R: 100 }); add('wire', P(24, 6), P(24, 18)); add('wire', P(24, 18), P(4, 18)); } },
  bjt: { name: 'Transistor switch', build(add) {
    add('dc', P(4, 4), P(4, 22)); add('wire', P(4, 4), P(24, 4)); add('switch', P(12, 4), P(12, 14), { closed: false }); add('resistor', P(12, 14), P(22, 14), { R: 10000 });
    add('bjt', P(22, 14), 0); add('resistor', P(24, 4), P(24, 8)); add('led', P(24, 8), P(24, 12), { color: 'green' }); add('wire', P(24, 16), P(24, 22)); add('wire', P(24, 22), P(4, 22)); } },
  ac: { name: 'AC rectifier', build(add) {
    add('ac', P(4, 6), P(4, 18), { V: 10, f: 1 }); add('diode', P(4, 6), P(12, 6)); add('capacitor', P(12, 6), P(12, 18), { C: 470, Vmax: 25 }); add('wire', P(12, 6), P(22, 6));
    add('resistor', P(22, 6), P(22, 12), { R: 1000 }); add('led', P(22, 12), P(22, 18), { color: 'blue' }); add('wire', P(22, 18), P(4, 18)); } },
};

/**
 * hooks: onLog({t,msg,bad}), onChange() when selection/parts/tool change, onFail(part)
 */
export function createBench(cv, scope, hooks) {
  const ctx = cv.getContext('2d');
  let held = null; // push button currently held down
  let els = [], uid = 0, selected = null, multi = new Set(), marquee = null, clip = null, pasteN = 0, selT = 0, tool = 'select', running = true, speed = 1, t = 0;
  let nodeIdx = new Map(), n = 0, V = new Float64Array(0), A = null, z = null, junctions = [];
  let particles = [], shakeT = 0, dirty = true, persist = true, allowed = null, clock = 0;
  let drawing = null, hover = null, drag = null, pan = null, raf = 0;
  // Camera over an unbounded grid: screen = (world - cam) * zoom, in CSS pixels.
  const cam = { x: 0, y: 0, z: 1 };
  let viewW = 900, viewH = 540;

  const key = (p) => p.x + ',' + p.y;
  const rotv = (dx, dy, r) => { for (let i = 0; i < r; i++) [dx, dy] = [-dy, dx]; return [dx, dy]; };
  const changed = () => hooks.onChange?.();
  const log = (msg, bad) => hooks.onLog?.({ t, msg, bad });

  function terms(e) {
    if (e.type === 'bjt') return [[0, 0], [2, -2], [2, 2]].map(([dx, dy]) => { const [a, b] = rotv(dx, dy, e.rot); return { x: e.p.x + a, y: e.p.y + b }; });
    return [e.a, e.b];
  }
  function nextName(type) {
    const pre = TYPES[type].pre; if (!pre) return '';
    let m = 0; for (const e of els) { if (e.name && e.name.startsWith(pre)) { const k = +e.name.slice(pre.length); if (k > m && TYPES[e.type].pre === pre) m = k; } }
    return pre + (m + 1);
  }
  function mk(type, a, b, props, name, locked) {
    const e = { id: ++uid, type, props: Object.assign(TYPES[type].def(), props || {}), heat: 0, failed: false, I: 0, vc: 0, vj: 0, vbe: 0, vbc: 0, ph: [0, 0, 0], P: 0, Vd: 0, flame: 0, stress: 0, shortLogged: false, hist: [], locked: !!locked };
    if (type === 'bjt') { e.p = { x: a.x, y: a.y }; e.rot = b || 0; } else { e.a = { x: a.x, y: a.y }; e.b = { x: b.x, y: b.y }; }
    e.name = name || nextName(type);
    if (type === 'button') e.props.pressed = false; // never saved or restored held down
    return e;
  }
  function add(type, a, b, props, locked, name) { const e = mk(type, a, b, props, name || null, locked); els.push(e); dirty = true; return e; }

  /* ---------- topology ---------- */
  function splitWires() {
    for (let guard = 0; guard < 300; guard++) {
      const pts = []; for (const e of els) for (const p of terms(e)) pts.push(p);
      let did = false;
      for (const w of els) {
        if (w.type !== 'wire') continue;
        const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L2 = dx * dx + dy * dy; if (!L2) continue;
        for (const p of pts) {
          const px = p.x - w.a.x, py = p.y - w.a.y;
          if (px * dy - py * dx !== 0) continue;
          const d = px * dx + py * dy; if (d <= 0 || d >= L2) continue;
          const w2 = mk('wire', { x: p.x, y: p.y }, { x: w.b.x, y: w.b.y }, null, null, w.locked); w.b = { x: p.x, y: p.y }; els.push(w2); did = true; break;
        }
        if (did) break;
      }
      if (!did) return;
    }
  }
  function build() {
    els = els.filter((e) => e.type === 'bjt' || e.a.x !== e.b.x || e.a.y !== e.b.y);
    splitWires();
    const count = new Map(); const keys = [];
    for (const e of els) for (const p of terms(e)) { const k = key(p); if (!count.has(k)) { count.set(k, 0); keys.push(k); } count.set(k, count.get(k) + 1); }
    const src = els.find((e) => e.type === 'dc' || e.type === 'ac');
    const gk = src ? key(src.b) : keys[0];
    nodeIdx = new Map(); n = 0;
    for (const k of keys) nodeIdx.set(k, k === gk ? -1 : n++);
    for (const e of els) e.n = terms(e).map((p) => nodeIdx.get(key(p)));
    junctions = keys.filter((k) => count.get(k) >= 3).map((k) => k.split(',').map(Number));
    V = new Float64Array(n); A = new Float64Array(n * n); z = new Float64Array(n);
    for (const e of els) { e.vj = 0; e.vbe = 0; e.vbc = 0; }
    dirty = false; save(); changed();
  }

  /* ---------- device models (shared in models.js) ---------- */
  const dpar = (e) => diodeParams(e.type === 'led', e.props.color);
  const srcV = (e) => (e.type === 'dc' ? e.props.V : e.props.V * Math.sin(2 * Math.PI * e.props.f * t));

  /* ---------- solver ---------- */
  const vn = (i) => (i < 0 ? 0 : V[i]);
  function addA(r, c, v) { if (r >= 0 && c >= 0) A[r * n + c] += v; }
  function addZ(r, v) { if (r >= 0) z[r] += v; }
  function sg(a, b, g) { addA(a, a, g); addA(b, b, g); addA(a, b, -g); addA(b, a, -g); }
  function si(a, b, i) { addZ(a, -i); addZ(b, i); }
  function stamp(e, dt) {
    const [a, b] = e.n, p = e.props;
    switch (e.type) {
      case 'wire': sg(a, b, 1e3); return true;
      case 'switch': if (p.closed) sg(a, b, 1e3); return true;
      case 'button': if (p.pressed) sg(a, b, 1e3); return true;
      case 'resistor': sg(a, b, 1 / Math.max(p.R, 1e-3)); return true;
      case 'capacitor': { const g = p.C * 1e-6 / dt; sg(a, b, g); si(a, b, -g * e.vc); return true; }
      case 'dc': case 'ac': { const g = 1 / Math.max(p.r, 1e-3); sg(a, b, g); si(a, b, -g * srcV(e)); return true; }
      case 'diode': case 'led': {
        const m = dpar(e), vraw = vn(a) - vn(b), v = dlimit(vraw, e.vj, m); e.vj = v;
        const [id, gd] = dcalc(v, m); sg(a, b, gd); si(a, b, id - gd * v);
        return Math.abs(v - vraw) < 1e-9;
      }
      case 'bjt': {
        const [nb, nc, ne] = e.n, s = p.pnp ? -1 : 1, Vb = vn(nb), Vc = vn(nc), Ve = vn(ne);
        const rbe = s * (Vb - Ve), rbc = s * (Vb - Vc);
        const vbe = pnj(rbe, e.vbe, VT, QVC), vbc = pnj(rbc, e.vbc, VT, QVC); e.vbe = vbe; e.vbc = vbc;
        const q = qcalc(vbe, vbc, Math.max(p.beta, 1));
        const aB = q.gF / p.beta, bB = q.gR / q.bR, aC = q.gF, bC = -q.gR * (1 + 1 / q.bR), aE = -(aB + aC), bE = -(bB + bC);
        const Ib0 = q.Ib, Ic0 = q.Ic, Ie0 = -(Ib0 + Ic0);
        for (const [nk, ak, bk, I0] of [[nb, aB, bB, Ib0], [nc, aC, bC, Ic0], [ne, aE, bE, Ie0]]) {
          const c = I0 - ak * vbe - bk * vbc;
          addA(nk, nb, ak + bk); addA(nk, ne, -ak); addA(nk, nc, -bk); addZ(nk, -s * c);
        }
        sg(nb, ne, 1e-12); sg(nb, nc, 1e-12);
        return Math.abs(vbe - rbe) < 1e-9 && Math.abs(vbc - rbc) < 1e-9;
      }
    }
    return true;
  }
  function solve() {
    for (let k = 0; k < n; k++) {
      let piv = k, mx = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; piv = i; } }
      if (piv !== k) { for (let j = 0; j < n; j++) { const tmp = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = tmp; } const tz = z[k]; z[k] = z[piv]; z[piv] = tz; }
      let pv = A[k * n + k]; if (Math.abs(pv) < 1e-30) pv = A[k * n + k] = 1e-30;
      for (let i = k + 1; i < n; i++) { const f = A[i * n + k] / pv; if (f) { for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j]; z[i] -= f * z[k]; } }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j]; x[i] = s / A[i * n + i]; }
    return x;
  }
  function simStep(dt) {
    if (n > 0) {
      for (let it = 0; it < 60; it++) {
        A.fill(0); z.fill(0); let conv = true;
        for (let i = 0; i < n; i++) A[i * n + i] = 1e-9;
        for (const e of els) if (!e.failed && !stamp(e, dt)) conv = false;
        const x = solve(); let md = 0, bad = false;
        for (let i = 0; i < n; i++) { if (!isFinite(x[i])) { bad = true; break; } md = Math.max(md, Math.abs(x[i] - V[i])); }
        if (bad) { V.fill(0); for (const e of els) { e.vj = 0; e.vbe = 0; e.vbc = 0; } break; }
        V = x; if (conv && md < 1e-6) break;
      }
    }
    post(dt); t += dt;
  }

  /* ---------- currents, stress and failures ---------- */
  function post(dt) {
    for (const e of els) {
      const p = e.props;
      if (e.failed) { e.I = 0; e.P = 0; e.Ib = e.Ic = e.Ie = 0; e.stress = 0; continue; }
      if (e.type === 'bjt') {
        const [nb, nc, ne] = e.n, s = p.pnp ? -1 : 1, Vb = vn(nb), Vc = vn(nc), Ve = vn(ne);
        const q = qcalc(s * (Vb - Ve), s * (Vb - Vc), Math.max(p.beta, 1));
        e.Ib = s * q.Ib; e.Ic = s * q.Ic; e.Ie = -(e.Ib + e.Ic);
        e.P = e.Ib * Vb + e.Ic * Vc + e.Ie * Ve; e.Vce = Vc - Ve;
        const r = Math.max(e.P / p.Pmax, Math.abs(e.Ic) / 0.8, Math.abs(e.Ib) / 0.1);
        e.stress = r; heat(e, r, 0.8, dt);
        if (e.heat >= 1) fail(e, `${e.name} burned out: ${fW(e.P)} in a transistor rated for ${p.Pmax} W.`);
        continue;
      }
      const [a, b] = e.n, vab = vn(a) - vn(b); e.Vd = vab;
      switch (e.type) {
        case 'wire': e.I = 1e3 * vab; e.P = 0; break;
        case 'switch': e.I = p.closed ? 1e3 * vab : 0; e.P = 0; break;
        case 'button': e.I = p.pressed ? 1e3 * vab : 0; e.P = 0; break;
        case 'resistor': {
          e.I = vab / Math.max(p.R, 1e-3); e.P = e.I * e.I * p.R; e.stress = e.P / p.P; heat(e, e.stress, 0.8, dt);
          if (e.heat >= 1) fail(e, `${e.name} burned out: ${fW(e.P)} in a ${p.P} W resistor. It is now an open circuit.`);
          break;
        }
        case 'capacitor': {
          const g = p.C * 1e-6 / dt; e.I = g * (vab - e.vc); e.vc = vab; e.P = e.I * vab;
          let over = Math.max(0, Math.abs(vab) - p.Vmax), rev = false;
          if (p.polar && vab < -1 && (-vab - 1) > over) { over = -vab - 1; rev = true; }
          e.stress = Math.max(Math.abs(vab) / p.Vmax, p.polar && vab < 0 ? -vab : 0);
          if (over > 0) e.heat += over * dt * 0.25; else e.heat = Math.max(0, e.heat - dt * 0.1);
          if (e.heat >= 1) fail(e, rev ? `${e.name} burst: charged backwards to ${vab.toFixed(1)} V. Electrolytic capacitors are polarized.` : `${e.name} burst: ${Math.abs(vab).toFixed(1)} V across a ${p.Vmax} V capacitor.`);
          break;
        }
        case 'diode': case 'led': {
          const m = dpar(e); e.I = dcalc(vab, m)[0]; e.P = e.I * vab;
          e.stress = Math.abs(e.I) / p.Imax; heat(e, e.stress, 1.5, dt);
          if (e.heat >= 1) {
            const what = e.type === 'led' ? 'LED' : 'diode';
            fail(e, e.I < 0 ? `${e.name} failed in reverse breakdown: ${fA(-e.I)} flowing backwards through the ${what}.` : `${e.name} burst: ${fA(e.I)} through ${what === 'LED' ? 'an LED' : 'a diode'} rated for ${fA(p.Imax)}.`);
          }
          break;
        }
        case 'dc': case 'ac': {
          e.I = (vab - srcV(e)) / Math.max(p.r, 1e-3); e.P = -e.I * vab;
          if (Math.abs(e.I) > 5 && !e.shortLogged) { e.shortLogged = true; log(`${e.name} is close to a short circuit: ${fA(Math.abs(e.I))}. A real battery would heat up fast.`, true); }
          if (Math.abs(e.I) < 1) e.shortLogged = false;
          break;
        }
      }
    }
  }
  function heat(e, ratio, rate, dt) { if (ratio > 1) e.heat += (ratio - 1) * dt * rate; else e.heat = Math.max(0, e.heat - dt * 0.2); }
  function fail(e, msg) {
    e.failed = true; e.heat = 1; e.I = 0; e.vc = 0; log(msg, true);
    const c = center(e), col = e.type === 'led' ? LEDC[e.props.color].c : '#ffb347';
    if (e.type === 'resistor') { e.flame = 1.4; burst(c, 10, ['#ff7a1a', '#ffcf4a'], 6); }
    else if (e.type === 'capacitor') { flash(c, '#ffffff'); burst(c, 34, ['#ffffff', '#c9ccd2', '#8a8f98', '#ff6a3d'], 12); shakeT = 0.45; }
    else if (e.type === 'bjt') { flash(c, '#ffffff'); burst(c, 14, ['#ff8a3d', '#ffd27a'], 12); }
    else { flash(c, col); burst(c, 22, [col, '#ffffff', '#ffcf6a'], 7); if (e.type === 'led') shakeT = 0.15; }
    hooks.onFail?.(e); changed();
  }

  /* ---------- particles ---------- */
  function flash(c, col) { particles.push({ k: 'flash', x: c.x, y: c.y, age: 0, life: 0.28, col }); particles.push({ k: 'ring', x: c.x, y: c.y, age: 0, life: 0.5 }); }
  function burst(c, count, cols, smoke) {
    const nP = reduceMotion ? Math.ceil(count / 4) : count;
    for (let i = 0; i < nP; i++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 220;
      particles.push({ k: 'spark', x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90, age: 0, life: 0.6 + Math.random() * 0.7, col: cols[i % cols.length], r: 1.2 + Math.random() * 2.2 }); }
    for (let i = 0; i < smoke; i++) puff(c, i * 0.08);
  }
  function puff(c, delay = 0) { particles.push({ k: 'smoke', x: c.x + (Math.random() - 0.5) * 10, y: c.y, vx: (Math.random() - 0.5) * 14, vy: -18 - Math.random() * 22, age: -delay, life: 2.2 + Math.random(), r: 4 }); }
  function stepParticles(dt) {
    for (const p of particles) {
      p.age += dt; if (p.age < 0) continue;
      if (p.k === 'spark') { p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      else if (p.k === 'smoke' || p.k === 'flame') { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    particles = particles.filter((p) => p.age < p.life);
    for (const e of els) {
      if (e.flame > 0) { e.flame -= dt; const c = center(e); if (Math.random() < 0.8) particles.push({ k: 'flame', x: c.x + (Math.random() - 0.5) * 22, y: c.y, vx: (Math.random() - 0.5) * 10, vy: -40 - Math.random() * 30, age: 0, life: 0.35 + Math.random() * 0.3 }); if (Math.random() < dt * 6) puff(c); }
      else if (!e.failed && e.heat > 0.2 && Math.random() < e.heat * dt * 5) puff(center(e));
    }
    if (shakeT > 0) shakeT -= dt;
  }

  /* ---------- geometry ---------- */
  function center(e) {
    if (e.type === 'bjt') { const [dx, dy] = rotv(1.45, 0, e.rot); return { x: (e.p.x + dx) * G, y: (e.p.y + dy) * G }; }
    return { x: (e.a.x + e.b.x) / 2 * G, y: (e.a.y + e.b.y) / 2 * G };
  }
  function distSeg(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1; let u = ((px - ax) * dx + (py - ay) * dy) / L; u = Math.max(0, Math.min(1, u)); return Math.hypot(px - ax - u * dx, py - ay - u * dy); }
  function hit(px, py) {
    let best = null, bd = 1e9;
    for (const e of els) {
      let d;
      if (e.type === 'bjt') { const c = center(e); d = Math.hypot(px - c.x, py - c.y); if (d > G * 1.7) continue; d -= 6; }
      else { d = distSeg(px, py, e.a.x * G, e.a.y * G, e.b.x * G, e.b.y * G); if (d > 8) continue; if (e.type === 'wire') d += 4; }
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  const gridLen = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- drawing: light on glass ---------- */
  const C = { bg: '#0a0a0a', dot: '#2c2c2c', major: '#4c4c4c', etch: '#3a3a3a', wire: '#8f8f8f', ink: '#eeeeee', faint: '#8a8a8a', dead: '#4a4a4a', accent: '#f4f4f4', ok: '#5fd38d', warn: '#f0a043', danger: '#ef5b4c', smoke: '#7a7a7a' };
  const FONT = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
  function readTokens() {
    const root = cv.closest('.mh-root'); if (!root) return;
    const cs = getComputedStyle(root);
    for (const [k, v] of [['accent', '--mh-accent'], ['ok', '--mh-ok'], ['warn', '--mh-warn'], ['danger', '--mh-danger']]) { const s = cs.getPropertyValue(v).trim(); if (s) C[k] = s; }
    // Text colour and glow come from the Settings menu (see textStyle in App.jsx).
    const t = cs.getPropertyValue('--cb-text').trim(), tf = cs.getPropertyValue('--cb-text-faint').trim();
    C.text = t || C.ink; C.textFaint = tf || C.faint; C.glow = root.hasAttribute('data-cb-glow');
  }
  /** Set up a text fill; with glow on, the text gets a halo in its own colour. */
  function textFill(g, col) { g.fillStyle = col; if (C.glow) { g.shadowColor = col; g.shadowBlur = 6; } else g.shadowBlur = 0; }
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const plus = (x, y, s = 4) => { line(x - s, y, x + s, y); line(x, y - s, x, y + s); };
  const glow = (col, b) => { ctx.shadowColor = col; ctx.shadowBlur = b; };
  function soot(x, y, r) { ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  function heatTint(h) { return h > 0.6 ? C.danger : C.warn; }

  // Lock-on brackets: snap in from outside when a part is selected.
  function brackets(x0, y0, x1, y1) {
    const k = Math.max(0, 1 - (clock - selT) / 0.22), ease = 1 - (1 - (1 - k)) ** 3, off = 10 * (1 - ease) + 3, s = 6;
    const xa = x0 - off, ya = y0 - off, xb = x1 + off, yb = y1 + off;
    ctx.save(); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; glow(C.accent, 8); ctx.lineCap = 'square';
    for (const [x, y, dx, dy] of [[xa, ya, 1, 1], [xb, ya, -1, 1], [xa, yb, 1, -1], [xb, yb, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x + dx * s, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * s); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTwo(e, ghost) {
    const ax = e.a.x * G, ay = e.a.y * G, bx = e.b.x * G, by = e.b.y * G, L = Math.hypot(bx - ax, by - ay), c = L / 2, p = e.props;
    const sel = multi.has(e), ink = e.failed ? C.dead : sel ? C.accent : C.ink;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(by - ay, bx - ax));
    if (ghost) ctx.globalAlpha = 0.45;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!e.failed) glow(ink, sel ? 10 : 5);
    switch (e.type) {
      case 'wire': ctx.strokeStyle = sel ? C.accent : C.wire; ctx.shadowBlur = sel ? 8 : 0; line(0, 0, L, 0); break;
      case 'resistor': {
        line(0, 0, c - 18, 0); line(c + 18, 0, L, 0);
        if (!e.failed && e.heat > 0.02) { ctx.strokeStyle = heatTint(e.heat); glow(ctx.strokeStyle, 6 + e.heat * 16); }
        const pts = [[c - 18, 0], [c - 15, -7], [c - 9, 7], [c - 3, -7], [c + 3, 7], [c + 9, -7], [c + 15, 7], [c + 18, 0]];
        ctx.beginPath(); pts.forEach(([x, y], i) => { if (e.failed && i === 4) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 3, y); } else i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        if (!e.failed && e.heat > 0.05) { ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = Math.min(0.4, e.heat * 0.5); ctx.fillStyle = heatTint(e.heat); ctx.beginPath(); ctx.ellipse(c, 0, 24, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        if (e.failed) soot(c, 0, 16);
        break;
      }
      case 'capacitor': {
        line(0, 0, c - 4, 0); line(c + 5, 0, L, 0);
        ctx.save(); ctx.translate(c, 0);
        if (!e.failed && e.heat > 0) { const s = 1 + e.heat * 0.4, j = reduceMotion ? 0 : (Math.random() - 0.5) * e.heat * 3; ctx.translate(j, j * 0.5); ctx.scale(s, s); }
        if (!e.failed) {
          const q = Math.min(1, Math.abs(e.vc) / Math.max(p.Vmax, 1)); const rev = p.polar && e.vc < -0.5;
          if (q > 0.01) { ctx.save(); ctx.globalAlpha = 0.15 + q * 0.55; ctx.fillStyle = rev ? C.danger : C.ink; ctx.fillRect(-3, -11 + 22 * (1 - q), 7, 22 * q); ctx.restore(); }
          ctx.lineWidth = 2.6; line(-4, -12, -4, 12);
          if (p.polar) { ctx.beginPath(); ctx.moveTo(7, -12); ctx.quadraticCurveTo(1, 0, 7, 12); ctx.stroke(); ctx.lineWidth = 1.2; plus(-12, -13, 3); }
          else line(5, -12, 5, 12);
          if (e.heat > 0.05) { ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = Math.min(0.4, e.heat * 0.5); ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        } else {
          ctx.lineWidth = 2.6; ctx.save(); ctx.rotate(-0.5); line(-4, -12, -4, 10); ctx.restore(); ctx.save(); ctx.rotate(0.55); line(6, -10, 6, 12); ctx.restore(); soot(0, 0, 15);
        }
        ctx.restore(); break;
      }
      case 'diode': case 'led': {
        line(0, 0, c - 9, 0); line(c + 9, 0, L, 0);
        const lc = e.type === 'led' ? LEDC[p.color].c : null;
        const br = !e.failed && e.I > 0 ? Math.min(1, e.I / 0.02) : 0;
        if (lc && br > 0.01) { ctx.save(); ctx.shadowBlur = 0; const g = ctx.createRadialGradient(c, 0, 2, c, 0, 40); g.addColorStop(0, lc); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = Math.min(1, br * (e.heat > 0.05 ? 1.3 : 0.9)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, 0, 40, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        ctx.beginPath(); ctx.moveTo(c - 9, -9); ctx.lineTo(c - 9, 9); ctx.lineTo(c + 9, 0); ctx.closePath();
        if (e.failed) { ctx.fillStyle = '#151515'; ctx.fill(); }
        else if (lc) { ctx.save(); ctx.globalAlpha = 0.1 + br * 0.9; ctx.fillStyle = lc; glow(lc, br * 14); ctx.fill(); ctx.restore(); }
        ctx.stroke(); line(c + 9, -9, c + 9, 9);
        if (lc) { ctx.lineWidth = 1.2; for (const o of [-4, 3]) { line(c + o, -12, c + o + 6, -19); line(c + o + 6, -19, c + o + 2, -18.5); line(c + o + 6, -19, c + o + 5.5, -15); } }
        if (e.failed) { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c - 7, -6); ctx.lineTo(c - 1, 1); ctx.lineTo(c - 4, 4); ctx.lineTo(c + 3, 8); ctx.stroke(); soot(c, 0, 14); }
        else if (e.heat > 0.05) { ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = Math.min(0.45, e.heat * 0.55); ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(c, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        break;
      }
      case 'dc': line(0, 0, c - 4, 0); line(c + 4, 0, L, 0); ctx.lineWidth = 1.6; line(c - 4, -13, c - 4, 13); ctx.lineWidth = 4; line(c + 4, -7, c + 4, 7); ctx.lineWidth = 1.2; plus(c - 12, -14, 3); break;
      case 'ac': {
        line(0, 0, c - 15, 0); line(c + 15, 0, L, 0); ctx.beginPath(); ctx.arc(c, 0, 15, 0, Math.PI * 2); ctx.stroke();
        const ph = 2 * Math.PI * p.f * t;
        ctx.beginPath(); for (let i = -9; i <= 9; i++) { const y = -5 * Math.sin(i / 9 * Math.PI + ph); i === -9 ? ctx.moveTo(c + i, y) : ctx.lineTo(c + i, y); } ctx.stroke();
        ctx.lineWidth = 1.2; plus(c - 22, -12, 3); break;
      }
      case 'button': {
        line(0, 0, c - 16, 0); line(c + 16, 0, L, 0);
        for (const cx of [c - 16, c + 16]) { ctx.beginPath(); ctx.arc(cx, 0, 2.6, 0, Math.PI * 2); ctx.fill(); }
        const by = p.pressed ? -3 : -11;
        ctx.lineWidth = 2; line(c - 18, by, c + 18, by); ctx.lineWidth = 1.6;
        line(c, by, c, by - 9); line(c - 6, by - 9, c + 6, by - 9);
        break;
      }
      case 'switch': {
        line(0, 0, c - 16, 0); line(c + 16, 0, L, 0);
        ctx.beginPath(); ctx.moveTo(c - 13, 0); ctx.lineTo(c - 16, -3); ctx.lineTo(c - 19, 0); ctx.lineTo(c - 16, 3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(c + 19, 0); ctx.lineTo(c + 16, -3); ctx.lineTo(c + 13, 0); ctx.lineTo(c + 16, 3); ctx.closePath(); ctx.fill();
        if (p.closed) line(c - 16, 0, c + 16, 0); else line(c - 16, 0, c + 12, -14);
        break;
      }
    }
    ctx.restore();
    if (!ghost) {
      label(e, ax, ay, bx, by);
      if (sel) {
        const ux = (bx - ax) / (L || 1), uy = (by - ay) / (L || 1), w = e.type === 'wire' ? 4 : 18;
        const xs = [ax, bx, ax - uy * w, ax + uy * w, bx - uy * w, bx + uy * w], ys = [ay, by, ay + ux * w, ay - ux * w, by + ux * w, by - ux * w];
        brackets(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      }
      if (e.locked) { ctx.save(); ctx.fillStyle = C.faint; ctx.font = `500 8px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('◆', ax, ay - 7); ctx.restore(); }
    }
  }
  function label(e, ax, ay, bx, by) {
    if (e.type === 'wire') return;
    const ux = bx - ax, uy = by - ay, L = Math.hypot(ux, uy) || 1; let nx = -uy / L, ny = ux / L;
    if (ny > 0.01 || (Math.abs(ny) <= 0.01 && nx < 0)) { nx = -nx; ny = -ny; }
    const mx = (ax + bx) / 2, my = (ay + by) / 2, vert = Math.abs(nx) > Math.abs(ny);
    ctx.save(); ctx.font = `500 10px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = vert ? 'left' : 'center';
    const off = e.type === 'led' ? 30 : e.type === 'ac' ? 24 : 22, x = mx + nx * (vert ? off - 4 : off), y = my + ny * (vert ? off - 4 : off);
    textFill(ctx, e.failed ? C.danger : multi.has(e) ? C.text : C.textFaint);
    ctx.fillText((e.name + ' ' + valueText(e) + (e.failed ? ' / FAIL' : '')).toUpperCase(), x, y); ctx.restore();
  }
  function bjtPts(e) {
    const tr = (x, y) => { const [dx, dy] = rotv(x, y, e.rot); return { x: (e.p.x + dx) * G, y: (e.p.y + dy) * G }; };
    return { tr, base: [tr(0, 0), tr(1, 0)], col: [tr(2, -2), tr(2, -1.1), tr(1, -0.35)], emi: [tr(2, 2), tr(2, 1.1), tr(1, 0.35)] };
  }
  function drawBjt(e, ghost) {
    const p = e.props, sel = multi.has(e);
    ctx.save(); ctx.translate(e.p.x * G, e.p.y * G); ctx.rotate(e.rot * Math.PI / 2); if (ghost) ctx.globalAlpha = 0.45;
    const ink = e.failed ? C.dead : sel ? C.accent : C.ink;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!e.failed) glow(ink, sel ? 10 : 5);
    const cx = 1.45 * G;
    if (e.failed) { ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(cx, 0, 1.25 * G, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = ink; }
    else if (e.heat > 0.02) { ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = Math.min(0.5, e.heat * 0.6); ctx.fillStyle = heatTint(e.heat); ctx.beginPath(); ctx.arc(cx, 0, 1.25 * G, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ctx.beginPath(); ctx.arc(cx, 0, 1.25 * G, 0, Math.PI * 2); ctx.stroke();
    line(0, 0, G, 0); ctx.lineWidth = 3; line(G, -0.7 * G, G, 0.7 * G); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(G, -0.35 * G); ctx.lineTo(2 * G, -1.1 * G); ctx.lineTo(2 * G, -2 * G); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(G, 0.35 * G); ctx.lineTo(2 * G, 1.1 * G); ctx.lineTo(2 * G, 2 * G); ctx.stroke();
    const ang = Math.atan2(0.75, 1), out = !p.pnp, ax = out ? 1.82 * G : 1.25 * G, ay = out ? 0.965 * G : 0.535 * G;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(out ? ang : ang + Math.PI); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -4); ctx.lineTo(-7, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    if (e.failed) { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 10, -12); ctx.lineTo(cx - 2, -2); ctx.lineTo(cx - 6, 4); ctx.lineTo(cx + 4, 13); ctx.stroke(); }
    ctx.restore();
    if (!ghost) {
      const Pt = bjtPts(e).tr(0.1, -1.35);
      ctx.save(); ctx.font = `500 10px ${FONT}`; textFill(ctx, e.failed ? C.danger : sel ? C.text : C.textFaint); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText((e.name + ' ' + valueText(e) + (e.failed ? ' / FAIL' : '')).toUpperCase(), Pt.x, Pt.y); ctx.restore();
      if (sel) { const c = center(e); brackets(c.x - 1.3 * G - 0.2 * G, c.y - 2 * G, c.x + 1.3 * G, c.y + 2 * G); }
    }
  }
  function dotsAlong(pts, I, e, k, dtr) {
    const a = Math.abs(I); if (a < 2e-6 || e.failed) return;
    const sp = Math.min(220, 45 * Math.log10(1 + a * 1e4)) * Math.sign(I);
    e.ph[k] = (e.ph[k] + sp * dtr) % 16;
    let total = 0; const segs = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l; }
    for (let s = ((e.ph[k] % 16) + 16) % 16; s < total; s += 16) {
      let r = s, i = 0; while (i < segs.length - 1 && r > segs[i]) { r -= segs[i]; i++; }
      const f = segs[i] ? r / segs[i] : 0, x = pts[i].x + (pts[i + 1].x - pts[i].x) * f, y = pts[i].y + (pts[i + 1].y - pts[i].y) * f;
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      if (p.age < 0) continue; const f = p.age / p.life;
      ctx.save();
      if (p.k === 'flash') { ctx.globalAlpha = Math.max(0, 1 - f); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 8 + f * 70, 0, Math.PI * 2); ctx.fill(); }
      else if (p.k === 'ring') { ctx.globalAlpha = Math.max(0, 1 - f); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; const r = 10 + f * 110; ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2); }
      else if (p.k === 'spark') { ctx.globalAlpha = 1 - f; ctx.fillStyle = p.col; glow(p.col, 6); ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
      else if (p.k === 'smoke') { ctx.globalAlpha = 0.3 * (1 - f); ctx.fillStyle = C.smoke; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.age * 14, 0, Math.PI * 2); ctx.fill(); }
      else if (p.k === 'flame') { ctx.globalAlpha = 1 - f; ctx.fillStyle = f < 0.4 ? '#ffd34d' : '#ff6a1a'; ctx.beginPath(); ctx.arc(p.x, p.y, 5 * (1 - f) + 1, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  // Only the visible part of the infinite grid is drawn. Dots fade out when zoomed far out.
  function drawGrid() {
    const x0 = Math.floor(cam.x / G), x1 = Math.ceil((cam.x + viewW / cam.z) / G), y0 = Math.floor(cam.y / G), y1 = Math.ceil((cam.y + viewH / cam.z) / G);
    const dots = cam.z >= 0.45;
    ctx.lineWidth = 1 / cam.z;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const major = i % 5 === 0 && j % 5 === 0;
      if (major) { ctx.strokeStyle = C.major; plus(i * G, j * G, 3); } else if (dots) { ctx.fillStyle = C.dot; ctx.fillRect(i * G - 0.75, j * G - 0.75, 1.5, 1.5); }
    }
    // Origin cross marks the centre of the bench.
    ctx.strokeStyle = C.etch; plus(0, 0, 9);
  }
  // Graduated edge rulers in screen space, numbered in grid squares.
  function drawRulers(dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.shadowBlur = 0;
    ctx.strokeStyle = C.etch; textFill(ctx, C.textFaint); ctx.font = `400 9px ${FONT}`; ctx.lineWidth = 1;
    const step = cam.z < 0.4 ? 5 : 1, label = cam.z < 0.4 ? 25 : 5;
    const i0 = Math.ceil(cam.x / G / step) * step, i1 = (cam.x + viewW / cam.z) / G;
    for (let i = i0; i <= i1; i += step) { const x = Math.round((i * G - cam.x) * cam.z) + 0.5, m = i % label === 0; line(x, 0, x, m ? 8 : 4); line(x, viewH, x, viewH - (m ? 8 : 4)); if (m) { ctx.textAlign = 'center'; ctx.fillText(String(i), x, 18); } }
    const j0 = Math.ceil(cam.y / G / step) * step, j1 = (cam.y + viewH / cam.z) / G;
    for (let j = j0; j <= j1; j += step) { const y = Math.round((j * G - cam.y) * cam.z) + 0.5, m = j % label === 0; line(0, y, m ? 8 : 4, y); line(viewW, y, viewW - (m ? 8 : 4), y); if (m) { ctx.textAlign = 'left'; ctx.fillText(String(j), 11, y + 3); } }
  }
  function draw(dtr) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    viewW = w; viewH = h;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.shadowBlur = 0;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
    let sx = 0, sy = 0;
    if (shakeT > 0 && !reduceMotion) { sx = (Math.random() - 0.5) * 10 * shakeT / 0.45; sy = (Math.random() - 0.5) * 8 * shakeT / 0.45; }
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (sx - cam.x * cam.z), dpr * (sy - cam.y * cam.z));
    drawGrid();
    for (const e of els) if (e.type === 'wire') drawTwo(e);
    for (const e of els) if (e.type !== 'wire') (e.type === 'bjt' ? drawBjt(e) : drawTwo(e));
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.wire; for (const [x, y] of junctions) { ctx.beginPath(); ctx.moveTo(x * G, y * G - 4); ctx.lineTo(x * G + 4, y * G); ctx.lineTo(x * G, y * G + 4); ctx.lineTo(x * G - 4, y * G); ctx.closePath(); ctx.fill(); }
    ctx.save(); ctx.fillStyle = C.ink; glow(C.ink, 6);
    for (const e of els) {
      if (e.type === 'bjt') { const Pp = bjtPts(e); dotsAlong(Pp.base, e.Ib || 0, e, 0, dtr); dotsAlong(Pp.col, e.Ic || 0, e, 1, dtr); dotsAlong(Pp.emi, e.Ie || 0, e, 2, dtr); }
      else dotsAlong([{ x: e.a.x * G, y: e.a.y * G }, { x: e.b.x * G, y: e.b.y * G }], e.I, e, 0, dtr);
    }
    ctx.restore();
    if (drawing) { const g = mk(drawing.type, drawing.a, drawing.b, null, ' '); const ok = gridLen(drawing.a, drawing.b) >= TYPES[drawing.type].min; if (ok) drawTwo(g, true); else { ctx.strokeStyle = C.faint; ctx.setLineDash([4, 4]); line(drawing.a.x * G, drawing.a.y * G, drawing.b.x * G, drawing.b.y * G); ctx.setLineDash([]); } }
    if (hover) {
      if (tool === 'bjt' && !drawing) drawBjt(mk('bjt', hover, 0, null, ' '), true);
      const x = hover.x * G, y = hover.y * G;
      ctx.save(); ctx.strokeStyle = tool === 'select' || tool === 'delete' ? C.faint : C.accent; ctx.lineWidth = 1;
      line(x - 12, y, x - 5, y); line(x + 5, y, x + 12, y); line(x, y - 12, x, y - 5); line(x, y + 5, x, y + 12);
      textFill(ctx, C.textFaint); ctx.font = `400 9px ${FONT}`; ctx.textAlign = 'left';
      ctx.fillText(`X${hover.x} Y${hover.y}`, x + 9, y - 9); ctx.restore();
    }
    drawParticles();
    if (marquee) {
      ctx.save(); ctx.strokeStyle = C.accent; ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1 / cam.z; ctx.setLineDash([5 / cam.z, 4 / cam.z]);
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
    drawRulers(dpr);
  }

  /* ---------- camera ---------- */
  function zoomAt(f, sx = viewW / 2, sy = viewH / 2) {
    const z = Math.max(0.2, Math.min(3, cam.z * f)), wx = cam.x + sx / cam.z, wy = cam.y + sy / cam.z;
    cam.z = z; cam.x = wx - sx / z; cam.y = wy - sy / z; changed();
  }
  // Frame every part with a margin; an empty bench centres on the origin.
  function fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) for (const p of terms(e)) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const w = cv.clientWidth || viewW, h = cv.clientHeight || viewH;
    if (!isFinite(x0)) { cam.z = 1; cam.x = -w / 2; cam.y = -h / 2; changed(); return; }
    const pad = 4, bw = (x1 - x0 + pad * 2) * G, bh = (y1 - y0 + pad * 2) * G;
    cam.z = Math.max(0.3, Math.min(1.6, Math.min(w / bw, h / bh)));
    cam.x = ((x0 + x1) / 2) * G - w / 2 / cam.z; cam.y = ((y0 + y1) / 2) * G - h / 2 / cam.z; changed();
  }

  /* ---------- scope: selected part's V and I over time ---------- */
  const WIN = 6;
  function record() {
    for (const e of els) {
      if (e.type === 'wire') continue;
      e.hist.push([t, partV(e), partI(e)]);
      let k = 0; while (k < e.hist.length && e.hist[k][0] < t - WIN - 0.5) k++; if (k) e.hist.splice(0, k);
    }
  }
  function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x - 1e-15) return m * p; return 10 * p; }
  function niceRange(lo, hi, minSpan) {
    lo = Math.min(lo, 0); hi = Math.max(hi, 0); if (hi - lo < minSpan) hi = Math.max(hi, lo + minSpan);
    let step = niceStep((hi - lo) / 4), min = 0;
    for (let i = 0; i < 8; i++) { min = Math.floor(lo / step + 1e-9) * step; if (min + 4 * step >= hi - 1e-12) break; step = niceStep(step * 1.01); }
    return { min, max: min + 4 * step };
  }
  const fVx = (v) => num(Math.abs(v) < 1e-9 ? 0 : v) + 'V';
  function fAx(v) { const a = Math.abs(v); if (a < 1e-12) return '0mA'; return a >= 1 ? num(v) + 'A' : a >= 1e-3 ? num(v * 1e3) + 'mA' : num(v * 1e6) + 'µA'; }
  function drawScope() {
    if (!scope) return;
    const dpr = window.devicePixelRatio || 1, w = scope.clientWidth, h = scope.clientHeight; if (!w) return;
    if (scope.width !== Math.round(w * dpr) || scope.height !== Math.round(h * dpr)) { scope.width = Math.round(w * dpr); scope.height = Math.round(h * dpr); }
    const g = scope.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const pl = 50, pr = 54, pt = 6, pb = 18, W = w - pl - pr, H = h - pt - pb;
    const t1 = Math.max(t, WIN), t0 = t1 - WIN, X = (tt) => pl + (tt - t0) / (t1 - t0) * W;
    const e = selected && selected.type !== 'wire' ? selected : null;
    let yL = { min: 0, max: 10 }, yR = { min: 0, max: 0.01 };
    if (e) { let vlo = 0, vhi = 0, ilo = 0, ihi = 0; for (const p of e.hist) if (p[0] >= t0 - 0.2) { vlo = Math.min(vlo, p[1]); vhi = Math.max(vhi, p[1]); ilo = Math.min(ilo, p[2]); ihi = Math.max(ihi, p[2]); } yL = niceRange(vlo, vhi, 1); yR = niceRange(ilo, ihi, 1e-3); }
    g.font = `400 10px ${FONT}`; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const y = Math.round(pt + H - H * k / 4) + 0.5;
      g.strokeStyle = k === 0 || k === 4 ? '#3a3a3a' : '#242424'; g.setLineDash(k === 0 || k === 4 ? [] : [2, 4]); g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + W, y); g.stroke();
      textFill(g, C.textFaint); g.textAlign = 'right'; g.fillText(fVx(yL.min + (yL.max - yL.min) * k / 4), pl - 6, y + 3);
      g.textAlign = 'left'; g.fillText(fAx(yR.min + (yR.max - yR.min) * k / 4), pl + W + 6, y + 3);
    }
    g.setLineDash([]);
    for (let k = 0; k <= 12; k++) { const x = Math.round(pl + W * k / 12) + 0.5; g.strokeStyle = '#3a3a3a'; g.beginPath(); g.moveTo(x, pt + H); g.lineTo(x, pt + H + (k % 2 ? 3 : 6)); g.stroke(); if (k % 4 === 0) { textFill(g, C.textFaint); g.textAlign = k === 0 ? 'left' : k === 12 ? 'right' : 'center'; g.fillText((t0 + WIN * k / 12).toFixed(1) + 's', x, h - 3); } }
    if (!e) { textFill(g, C.textFaint); g.textAlign = 'center'; g.fillText('SELECT A PART TO PROBE IT', pl + W / 2, pt + H / 2); return; }
    g.save(); g.beginPath(); g.rect(pl, pt - 2, W, H + 4); g.clip(); g.lineJoin = 'round';
    const plot = (k, ax, col, dash, blur) => {
      const Y = (v) => pt + H - (v - ax.min) / (ax.max - ax.min) * H;
      g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(dash); g.shadowColor = col; g.shadowBlur = blur; g.beginPath(); let first = true;
      for (const p of e.hist) { if (p[0] < t0 - 0.2) continue; const x = X(p[0]), y = Y(p[k]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
      g.stroke();
    };
    plot(2, yR, '#9a9a9a', [4, 3], 0);
    plot(1, yL, C.accent, [], 8);
    g.restore();
  }

  /* ---------- undo history ---------- */
  // Snapshots of the layout (not the electrical state). checkpoint(key) folds repeated edits with the same
  // key, such as typing a resistance digit by digit, into one undo step.
  const hist = { past: [], future: [], key: null };
  const serialize = () => JSON.stringify(els.map((e) => ({ type: e.type, a: e.a, b: e.b, p: e.p, rot: e.rot, props: e.props, name: e.name, locked: e.locked })));
  function checkpoint(key = null) {
    if (key && key === hist.key) return;
    hist.past.push(serialize()); if (hist.past.length > 200) hist.past.shift();
    hist.future = []; hist.key = key;
  }
  function rebuild(json) {
    els = JSON.parse(json).map((d) => mk(d.type, d.type === 'bjt' ? d.p : d.a, d.type === 'bjt' ? d.rot : d.b, d.props, d.name, d.locked));
    selected = null; multi = new Set(); drawing = null; drag = null; particles = []; dirty = true; save(); changed();
  }
  function travel(back) {
    const from = back ? hist.past : hist.future, to = back ? hist.future : hist.past;
    if (!from.length) return;
    to.push(serialize()); hist.key = null; rebuild(from.pop());
    log(back ? 'Undo.' : 'Redo.');
  }
  const resetHistory = () => { hist.past = []; hist.future = []; hist.key = null; changed(); };

  /* ---------- editing ---------- */
  function select(e) { if (selected !== e) selT = clock; selected = e || null; multi = new Set(e ? [e] : []); changed(); }
  function setMulti(list) { multi = new Set(list); selected = multi.size === 1 ? [...multi][0] : null; selT = clock; changed(); }
  function toggle(e) { const m = new Set(multi); if (m.has(e)) m.delete(e); else m.add(e); setMulti([...m]); }
  function selectAll() { setMulti(els); }
  /** Delete everything selected that the mission allows, as one undo step. */
  function removeSelected() {
    const kill = [...multi].filter((e) => !e.locked);
    if (!kill.length) { if (multi.size) log('Mission parts cannot be removed.'); return; }
    checkpoint(); els = els.filter((e) => !kill.includes(e)); setMulti([...multi].filter((e) => e.locked)); dirty = true;
    log(kill.length > 1 ? `Deleted ${kill.length} parts.` : `Deleted ${kill[0].name || 'a wire'}.`);
  }
  const serial = (e) => ({ type: e.type, a: e.a && { ...e.a }, b: e.b && { ...e.b }, p: e.p && { ...e.p }, rot: e.rot, props: { ...e.props } });
  function copy() {
    const list = [...multi].filter((e) => !e.locked && allowedTool(e.type)); if (!list.length) return;
    clip = list.map(serial); pasteN = 0; log(`Copied ${list.length} ${list.length > 1 ? 'parts' : 'part'}.`); changed();
  }
  /** Paste the copied parts a little down and right of the originals; each paste steps further. */
  function paste() {
    if (!clip?.length) return;
    const off = 2 * ++pasteN, mv = (q) => q && { x: q.x + off, y: q.y + off };
    checkpoint();
    const made = clip.filter((d) => allowedTool(d.type)).map((d) => mk(d.type, d.type === 'bjt' ? mv(d.p) : mv(d.a), d.type === 'bjt' ? d.rot : mv(d.b), { ...d.props }));
    els.push(...made); dirty = true; setMulti(made);
    log(`Pasted ${made.length} ${made.length > 1 ? 'parts' : 'part'}.`);
  }
  function duplicate() { copy(); paste(); }
  function flip(e) {
    if (e.locked) return;
    checkpoint();
    if (e.type === 'bjt') e.props.pnp = !e.props.pnp; else { [e.a, e.b] = [e.b, e.a]; e.vc = -e.vc; }
    dirty = true; log(`Flipped ${e.name}.`); changed();
  }
  function rotate(e) { if (e.locked || e.type !== 'bjt') return; checkpoint(); e.rot = (e.rot + 1) % 4; dirty = true; changed(); }
  function toggleSwitch(e) { checkpoint(); e.props.closed = !e.props.closed; log(`${e.name} ${e.props.closed ? 'closed' : 'opened'}.`); save(); changed(); }
  function remove(e) { if (e.locked) { log(`${e.name || 'That wire'} is part of the mission and cannot be removed.`); return; } checkpoint(); els = els.filter((x) => x !== e); if (selected === e) selected = null; multi.delete(e); dirty = true; changed(); }
  function repair(e) { e.failed = false; e.heat = 0; e.vc = 0; changed(); }
  function replace(e, type) { if (e.locked || !allowedTool(type)) return; checkpoint(); const ne = mk(type, e.a, e.b); els[els.indexOf(e)] = ne; log(`Replaced ${e.name || 'wire'} with ${ne.name || 'a wire'}.`); select(ne); dirty = true; }
  function setProp(e, k, v) { if (e.locked) return; checkpoint(`prop:${e.id}:${k}`); e.props[k] = v; save(); changed(); }
  const allowedTool = (tl) => tl === 'select' || tl === 'delete' || !allowed || allowed.includes(tl);
  function setTool(tl) { if (!allowedTool(tl)) return; tool = tl; drawing = null; changed(); }
  function togglePlay() { running = !running; changed(); }
  function repairAll() { for (const e of els) { e.failed = false; e.heat = 0; e.vc = 0; e.flame = 0; e.hist = []; } t = 0; particles = []; dirty = true; log('All parts repaired and capacitors discharged.'); }
  function clear() { checkpoint(); els = els.filter((e) => e.locked); selected = null; multi = new Set(); particles = []; t = 0; dirty = true; log('Cleared the bench.'); }
  /** Replace the whole layout. build(add) places parts; add(type,a,b,props,locked). */
  function load(builder, opts = {}) {
    if (opts.undoable) checkpoint(); else { hist.past = []; hist.future = []; hist.key = null; }
    els = []; uid = 0; selected = null; multi = new Set(); particles = []; t = 0; drawing = null; drag = null;
    allowed = opts.allowed || null; persist = opts.persist ?? true;
    if (!allowedTool(tool)) tool = 'select';
    builder((type, a, b, props, locked, name) => add(type, a, b, props, locked, name));
    running = true; dirty = true; fit();
  }
  function loadExample(k) { load(EXAMPLES[k].build, { undoable: true }); log(`Loaded example: ${EXAMPLES[k].name}.`); }

  // Project files: the open bench as plain data, and back. Imported data is checked part by part.
  const exportCircuit = () => els.filter((e) => !e.locked).map((e) => ({ type: e.type, a: e.a, b: e.b, p: e.p, rot: e.rot, props: e.props, name: e.name }));
  function importCircuit(arr) {
    const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    const parts = Array.isArray(arr) ? arr.filter((d) => d && TYPES[d.type] && (d.type === 'bjt' ? ok(d.p) : ok(d.a) && ok(d.b))) : [];
    if (!parts.length) return 0;
    load(() => {
      for (const d of parts) {
        const props = {}; const def = TYPES[d.type].def();
        for (const k of Object.keys(def)) if (d.props && typeof d.props[k] === typeof def[k]) props[k] = d.props[k];
        els.push(mk(d.type, d.type === 'bjt' ? d.p : d.a, d.type === 'bjt' ? (Number.isFinite(d.rot) ? d.rot : 0) : d.b, props, typeof d.name === 'string' ? d.name.slice(0, 24) : null));
      }
    }, { undoable: true });
    save();
    return parts.length;
  }

  function save() { if (!persist) return; try { localStorage.setItem(SAVE, JSON.stringify(els.map((e) => ({ type: e.type, a: e.a, b: e.b, p: e.p, rot: e.rot, props: e.props, name: e.name })))); } catch (_) { /* storage blocked */ } }
  function restore() {
    try {
      const raw = localStorage.getItem(SAVE); if (!raw) return false; const arr = JSON.parse(raw); if (!Array.isArray(arr) || !arr.length) return false;
      load(() => { for (const d of arr.filter((d) => TYPES[d.type])) els.push(mk(d.type, d.type === 'bjt' ? d.p : d.a, d.type === 'bjt' ? d.rot : d.b, d.props, d.name)); });
      return els.length > 0;
    } catch (_) { return false; }
  }

  /* ---------- pointer and keys ---------- */
  function ptr(ev) { const r = cv.getBoundingClientRect(); return { x: cam.x + (ev.clientX - r.left) / cam.z, y: cam.y + (ev.clientY - r.top) / cam.z }; }
  const snap = (p) => ({ x: Math.round(p.x / G), y: Math.round(p.y / G) });
  function startPan(ev) { pan = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; cv.style.cursor = 'grabbing'; }
  function onDown(ev) {
    cv.setPointerCapture(ev.pointerId); const p = ptr(ev), g = snap(p);
    // Middle or right button, or the pan tool, always moves the view.
    if (ev.button === 1 || ev.button === 2) { ev.preventDefault(); startPan(ev); return; }
    if (tool === 'select' || tool === 'delete') {
      const e = hit(p.x, p.y);
      if (tool === 'delete') { if (e) remove(e); return; }
      if (ev.shiftKey && e) { toggle(e); return; }
      // Empty space: drag pans (trackpads have no right-drag); Shift+drag draws a selection box.
      if (!e) { if (ev.shiftKey) marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: [...multi] }; else { select(null); startPan(ev); } return; }
      const wasSel = multi.size === 1 && multi.has(e); // parts work once they are selected
      if (!multi.has(e)) select(e);
      if (e.type === 'button' && wasSel) { e.props.pressed = true; held = e; changed(); }
      let end = null;
      if (multi.size === 1 && e.type !== 'bjt') { if (Math.hypot(p.x - e.a.x * G, p.y - e.a.y * G) < 8) end = 'a'; else if (Math.hypot(p.x - e.b.x * G, p.y - e.b.y * G) < 8) end = 'b'; }
      const orig = new Map([...multi].map((q) => [q, q.type === 'bjt' ? { p: { ...q.p } } : { a: { ...q.a }, b: { ...q.b } }]));
      drag = { e, start: g, end, orig, moved: false, wasSel };
    } else if (tool === 'bjt') { checkpoint(); const e = add('bjt', g, 0); select(e); }
    else drawing = { type: tool, a: g, b: g };
  }
  function onMove(ev) {
    if (pan) { cam.x = pan.cx - (ev.clientX - pan.x) / cam.z; cam.y = pan.cy - (ev.clientY - pan.y) / cam.z; hover = null; return; }
    const p = ptr(ev), g = snap(p); hover = g;
    if (marquee) { marquee.x1 = p.x; marquee.y1 = p.y; return; }
    if (drawing) { drawing.b = g; return; }
    if (drag) {
      const dx = g.x - drag.start.x, dy = g.y - drag.start.y; if (!dx && !dy && !drag.moved) return;
      if (drag.e.locked && multi.size === 1) return;
      if (held) { held.props.pressed = false; held = null; } // moving a button is not pressing it
      if (!drag.moved) checkpoint(); // one undo step for the whole drag
      drag.moved = true;
      for (const [e, o] of drag.orig) {
        if (e.locked) continue; // mission parts stay put
        if (e.type === 'bjt') e.p = { x: o.p.x + dx, y: o.p.y + dy };
        else if (drag.end) e[drag.end] = { x: o[drag.end].x + dx, y: o[drag.end].y + dy };
        else { e.a = { x: o.a.x + dx, y: o.a.y + dy }; e.b = { x: o.b.x + dx, y: o.b.y + dy }; }
      }
    }
  }
  function onUp() {
    if (held) { held.props.pressed = false; held = null; changed(); }
    if (pan) { pan = null; cv.style.cursor = ''; changed(); return; }
    if (marquee) {
      const m = marquee; marquee = null;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (x1 - x0 < 4 && y1 - y0 < 4) { changed(); return; } // a click, not a box
      const inside = els.filter((e) => { const c = center(e); return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1; });
      setMulti([...new Set([...m.base, ...inside])]);
      return;
    }
    if (drawing) {
      const d = drawing; drawing = null;
      if (gridLen(d.a, d.b) >= TYPES[d.type].min) { checkpoint(); const e = add(d.type, d.a, d.b); select(e); }
      else if (gridLen(d.a, d.b) > 0) log('Parts need at least two grid squares. Drag a little further.');
    }
    if (drag) { if (!drag.moved && drag.wasSel && drag.e.type === 'switch') toggleSwitch(drag.e); if (drag.moved) dirty = true; drag = null; }
  }
  const onLeave = () => { hover = null; };
  function onWheel(ev) {
    ev.preventDefault(); const r = cv.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }
  const onMenu = (ev) => ev.preventDefault();
  function onKey(ev) {
    const tgt = ev.target;
    if (!cv.getClientRects().length) return; // the bench is hidden (another mode is open)
    if (tgt.closest && tgt.closest('input,select,textarea,[role=combobox],[role=listbox],[role=menu],[role=dialog]')) return;
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const key = ev.key.toLowerCase();
      if (key === 'z' && !ev.shiftKey) { ev.preventDefault(); travel(true); }
      else if (key === 'y' || (key === 'z' && ev.shiftKey)) { ev.preventDefault(); travel(false); }
      else if (key === 'c') { ev.preventDefault(); copy(); }
      else if (key === 'v') { ev.preventDefault(); paste(); }
      else if (key === 'd') { ev.preventDefault(); duplicate(); }
      else if (key === 'a') { ev.preventDefault(); selectAll(); }
      return;
    }
    if (ev.altKey) return;
    const k = ev.key.toLowerCase();
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && multi.size) { ev.preventDefault(); removeSelected(); }
    else if (k === 'f' && selected && selected.type !== 'wire') flip(selected);
    else if (k === 'r' && selected && selected.type === 'bjt') rotate(selected);
    else if (ev.key === ' ' && !(tgt.closest && tgt.closest('button'))) { ev.preventDefault(); togglePlay(); }
    else if (ev.key === 'Escape') { setTool('select'); select(null); }
    else { const tl = TOOLS.find((x) => x && x[2].toLowerCase() === k); if (tl) setTool(tl[0]); }
  }
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerleave', onLeave); cv.addEventListener('pointerup', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('contextmenu', onMenu);
  document.addEventListener('keydown', onKey);

  /* ---------- main loop ---------- */
  let last = null, lastTok = 0;
  function frame(ts) {
    const dtr = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts; clock = ts / 1000;
    if (ts - lastTok > 1000) { readTokens(); lastTok = ts; }
    if (dirty) build();
    if (running && dtr > 0) {
      const steps = n < 20 ? 60 : n < 50 ? 24 : 8, sd = dtr * speed / steps;
      for (let k = 0; k < steps; k++) simStep(sd);
      record();
    }
    stepParticles(dtr); draw(dtr); drawScope();
    raf = requestAnimationFrame(frame);
  }
  readTokens();
  raf = requestAnimationFrame(frame);

  return {
    get els() { return els; }, get selected() { return selected; }, get selection() { return [...multi]; }, get canPaste() { return !!clip?.length; },
    copy, paste, duplicate, selectAll, removeSelected, exportCircuit, importCircuit,
    // Logic missions: the test flips named input switches and reads the voltage at named output parts.
    byName: (n) => els.find((e) => e.name === n),
    setInput(n, on) { const e = els.find((q) => q.name === n); if (e) { e.props.closed = !!on; changed(); } },
    /** Voltage at terminal i of the named part (0 = its first end), relative to ground. */
    voltageAt(n, i = 0) { const e = els.find((q) => q.name === n); return e?.n ? vn(e.n[i]) : NaN; },
    /** The circuit node a named part's terminal sits on, to tell whether two points are wired together. */
    nodeOf(n, i = 0) { const e = els.find((q) => q.name === n); return e?.n ? e.n[i] : null; },
    /** True when two part terminals are joined by wires alone (wires are separate low-resistance parts here). */
    wiredTogether(n1, i1, n2, i2) {
      const a = els.find((q) => q.name === n1)?.n?.[i1], b = els.find((q) => q.name === n2)?.n?.[i2];
      if (a == null || b == null) return false;
      const seen = new Set([a]), todo = [a];
      while (todo.length) {
        const x = todo.pop(); if (x === b) return true;
        for (const w of els) if (w.type === 'wire' && !w.failed && w.n) for (const [p, q] of [[w.n[0], w.n[1]], [w.n[1], w.n[0]]]) if (p === x && !seen.has(q)) { seen.add(q); todo.push(q); }
      }
      return false;
    },
    press(e, down) { if (e?.type === 'button') { e.props.pressed = !!down; changed(); } }, get tool() { return tool; },
    get running() { return running; }, get speed() { return speed; }, get t() { return t; }, get nodes() { return n; },
    get allowed() { return allowed; },
    get canUndo() { return hist.past.length > 0; }, get canRedo() { return hist.future.length > 0; },
    undo: () => travel(true), redo: () => travel(false), resetHistory, get zoom() { return cam.z; },
    get center() { return { x: Math.round((cam.x + viewW / 2 / cam.z) / G), y: Math.round((cam.y + viewH / 2 / cam.z) / G) }; },
    setSpeed(s) { speed = s; changed(); },
    zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(0.8), fit,
    allowedTool, setTool, togglePlay, repairAll, clear, load, loadExample, restore,
    select, flip, rotate, toggleSwitch, remove, repair, replace, setProp,
    destroy() {
      cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('wheel', onWheel); cv.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('keydown', onKey);
    },
  };
}
