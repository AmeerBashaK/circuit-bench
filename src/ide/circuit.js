// Electrical solver for the Maker IDE bench. Every net from the wiring becomes a node; the board's
// power pins, GPIO outputs and module outputs are voltage sources with a little internal resistance,
// and discrete parts are stamped with the same models the Simulator uses. Ground is the board's GND.
import { BOARDS, pinsOf, propsOf } from './boards.js';
import { LEDC, QVC, VT, dcalc, dlimit, dpar, pnj, qcalc } from '../models.js';

const R_PWR = 0.3, R_GPIO = 30, R_PULL = 45000, R_MODULE = 200, R_SENSOR = 10000;
const GPIO_LIMIT = { esp32: 0.04, c3: 0.04, s3: 0.04, uno: 0.04, mega: 0.04, pico: 0.016 };
const fmtA = (i) => (Math.abs(i) >= 1 ? `${i.toFixed(2)} A` : `${Math.round(Math.abs(i) * 1000)} mA`);

/**
 * get() -> { layout, nl, env (part id -> values), pins (runtime gpio states, may be {}) }
 * onFail(part, message, info), onWarn(message). info.type is the part type, or 'pin' / 'short' for the board itself.
 */
export function createCircuit({ get, onFail, onWarn }) {
  const st = new Map(); // part id -> solver state
  let V = new Float64Array(0), last = performance.now(), warned = new Set();
  // Board damage: GPIO pins that were overloaded until they died, and whether power is shorted to GND.
  const pinHeat = new Map(), dead = new Set(); let shorted = false;
  // A path from power to GND through a closed switch is not a wire, so the netlist cannot see it. The board
  // trips instead when it draws far too much current, like a USB polyfuse, and retries a moment later.
  let tripUntil = 0, lastTrip = -1e9, tripReported = false, tripAmps = 0, tripHeat = 0;
  const TRIP_AMPS = 2;
  const S = (id) => { if (!st.has(id)) st.set(id, { heat: 0, failed: false, vj: 0, vj2: 0, vbe: 0, vbc: 0, vc: 0, I: 0, P: 0, Ib: 0, Ic: 0, Vd: 0 }); return st.get(id); };

  function solve() {
    const now = performance.now(), dt = Math.max(1e-4, Math.min(0.05, (now - last) / 1000)); last = now;
    const { layout, nl, env, pins = {} } = get();
    const B = BOARDS[layout.board], board = nl.board;
    const gndKey = pinsOf(board).find((p) => p.kind === 'gnd').key, ground = nl.netId(gndKey);
    // Node numbering: every net except ground, plus one internal node per LED module.
    const idx = new Map(); let n = 0;
    for (const root of nl.nets.keys()) if (root !== ground) idx.set(root, n++);
    const node = (key) => { const r = nl.netId(key); return r == null || r === ground ? -1 : idx.get(r); };
    const els = [];
    for (const o of layout.objects) {
      if (o.kind !== 'part' || o.type === 'rail') continue;
      const k = (name) => node(`${o.id}:${name}`);
      if (o.type === 'led') els.push({ o, type: 'ledmod', a: k('+'), m: n++, b: k('−') });
      else els.push({ o, type: o.type, k });
    }
    if (V.length !== n) V = new Float64Array(n);
    const A = new Float64Array(n * n), z = new Float64Array(n);
    const vn = (i) => (i < 0 ? 0 : V[i]);
    const addA = (r, c, v) => { if (r >= 0 && c >= 0) A[r * n + c] += v; };
    const addZ = (r, v) => { if (r >= 0) z[r] += v; };
    const sg = (a, b, g) => { addA(a, a, g); addA(b, b, g); addA(a, b, -g); addA(b, a, -g); };
    const si = (a, b, i) => { addZ(a, -i); addZ(b, i); };
    const src = (a, volts, r) => { if (a < 0) return; addA(a, a, 1 / r); addZ(a, volts / r); };

    // Sources that do not depend on the solution.
    const sources = [];
    const seen = new Set();
    const isShort = nl.shorts || now < tripUntil;
    if (isShort !== shorted) {
      shorted = isShort;
      if (shorted && nl.shorts) onFail?.(null, `brownout: the power pins are shorted to GND. The ${B.name} shuts down until the short is removed.`, { type: 'short' });
      else if (shorted && !tripReported) { tripReported = true; onFail?.(null, `brownout: the board tried to supply ${tripAmps.toFixed(1)} A. Something connects power to GND with almost no resistance.`, { type: 'short' }); }
    }
    if (now - lastTrip > 3000) tripReported = false;
    const powerNodes = [];
    if (!shorted) for (const p of pinsOf(board)) if (p.kind === 'power') { const a = node(p.key); if (a >= 0 && !seen.has(a)) { seen.add(a); sources.push([a, p.volts, R_PWR]); powerNodes.push([a, p.volts]); } }
    const gpioNode = {}, gpioLevel = {};
    for (const p of pinsOf(board)) if (p.kind === 'gpio' && gpioNode[p.gpio] == null) gpioNode[p.gpio] = node(p.key);
    for (const [g, s] of Object.entries(shorted ? {} : pins)) {
      // A pin wired straight to GND sits on the ground node (a = -1); it still sources current there.
      const a = gpioNode[g]; if (a == null || dead.has(+g)) continue;
      if (s.mode === 'OUTPUT') { const lv = s.pwm != null ? (B.logic * s.pwm) / 255 : s.value ? B.logic : 0; gpioLevel[g] = lv; sources.push([a, lv, R_GPIO]); }
      else if (s.mode === 'INPUT_PULLUP') sources.push([a, B.logic, R_PULL]);
      else if (s.mode === 'INPUT_PULLDOWN') sources.push([a, 0, R_PULL]);
    }
    for (const p of nl.parts) {
      if (shorted || !p.powered || !p.volts) continue;
      const e = { ...env[p.obj.id] }, k = (name) => node(`${p.obj.id}:${name}`), v = p.volts;
      switch (p.obj.type) {
        case 'pir': sources.push([k('OUT'), e.motion ? v : 0, R_MODULE]); break;
        case 'ir': sources.push([k('OUT'), e.obstacle ? 0 : v, R_MODULE]); break;
        case 'sonar': sources.push([k('ECHO'), 0, R_MODULE]); break;
        case 'soil': sources.push([k('AOUT'), (0.806 - (e.moisture ?? 55) * 0.00513) * v, R_SENSOR]); break;
        case 'ldr': sources.push([k('AOUT'), ((e.light ?? 70) / 100) * v, R_SENSOR]); break;
        case 'dht': sources.push([k('DATA'), v, 10000]); break; // the module's pull-up on DATA
      }
    }

    const partOf = new Map(nl.parts.map((p) => [p.obj.id, p]));
    function stampAll() {
      A.fill(0); z.fill(0); let conv = true;
      for (let i = 0; i < n; i++) A[i * n + i] = 1e-9;
      for (const [a, volts, r] of sources) src(a, volts, r);
      for (const el of els) {
        const s = S(el.o.id); if (s.failed) continue;
        const pr = propsOf(el.o), e = env[el.o.id] || {};
        const diode = (a, b, isLed, color, key = 'vj') => {
          const m = dpar(isLed, color), vraw = vn(a) - vn(b), v = dlimit(vraw, s[key], m); s[key] = v;
          const [id, gd] = dcalc(v, m); sg(a, b, gd); si(a, b, id - gd * v);
          if (Math.abs(v - vraw) > 1e-9) conv = false;
        };
        switch (el.type) {
          case 'resistor': sg(el.k('1'), el.k('2'), 1 / Math.max(pr.R, 1e-3)); break;
          case 'buzzer': sg(el.k('+'), el.k('−'), 1 / 330); break;
          case 'button': if (e.pressed) sg(el.k('1'), el.k('2'), 1e3); break;
          case 'toggle': if (e.on) sg(el.k('1'), el.k('2'), 1e3); break;
          case 'pot': { const t = Math.min(0.999, Math.max(0.001, (e.pos ?? 50) / 100)); sg(el.k('1'), el.k('W'), 1 / (pr.R * (1 - t))); sg(el.k('W'), el.k('3'), 1 / (pr.R * t)); break; } // turning the knob up moves the wiper toward pin 1
          case 'cap': { const g = (pr.C * 1e-6) / dt; sg(el.k('+'), el.k('−'), g); si(el.k('+'), el.k('−'), -g * s.vc); break; }
          case 'ledc': diode(el.k('A'), el.k('K'), true, pr.color); break;
          case 'diode': diode(el.k('A'), el.k('K'), false); break;
          case 'ledmod': sg(el.a, el.m, 1 / 220); diode(el.m, el.b, true, 'red'); break;
          case 'relay': {
            // The module's driver transistor loads IN lightly; the coil draws about 70 mA while it is on.
            sg(el.k('IN'), el.k('GND'), 1 / 4700);
            if (s.on) { sg(el.k('VCC'), el.k('GND'), 1 / 71); sg(el.k('COM'), el.k('NO'), 1e3); } else sg(el.k('COM'), el.k('NC'), 1e3);
            break;
          }
          // A 12 V battery in series with the bulb (48 Ω hot) between L1 and L2: its own circuit, apart from the board.
          case 'lamp': sg(el.k('L1'), el.k('L2'), 1 / 48); si(el.k('L1'), el.k('L2'), -12 / 48); break;
          case 'npn': {
            const nb = el.k('B'), nc = el.k('C'), ne = el.k('E'), Vb = vn(nb), Vc = vn(nc), Ve = vn(ne);
            const rbe = Vb - Ve, rbc = Vb - Vc;
            const vbe = pnj(rbe, s.vbe, VT, QVC), vbc = pnj(rbc, s.vbc, VT, QVC); s.vbe = vbe; s.vbc = vbc;
            const q = qcalc(vbe, vbc, Math.max(pr.beta, 1));
            const aB = q.gF / pr.beta, bB = q.gR / q.bR, aC = q.gF, bC = -q.gR * (1 + 1 / q.bR), aE = -(aB + aC), bE = -(bB + bC);
            const Ib0 = q.Ib, Ic0 = q.Ic, Ie0 = -(Ib0 + Ic0);
            for (const [nk, ak, bk, I0] of [[nb, aB, bB, Ib0], [nc, aC, bC, Ic0], [ne, aE, bE, Ie0]]) {
              const c = I0 - ak * vbe - bk * vbc;
              addA(nk, nb, ak + bk); addA(nk, ne, -ak); addA(nk, nc, -bk); addZ(nk, -c);
            }
            sg(nb, ne, 1e-12); sg(nb, nc, 1e-12);
            if (Math.abs(vbe - rbe) > 1e-9 || Math.abs(vbc - rbc) > 1e-9) conv = false;
            break;
          }
        }
      }
      return conv;
    }
    function lu() {
      for (let k = 0; k < n; k++) {
        let piv = k, mx = Math.abs(A[k * n + k]);
        for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; piv = i; } }
        if (piv !== k) { for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t; } const t = z[k]; z[k] = z[piv]; z[piv] = t; }
        let pv = A[k * n + k]; if (Math.abs(pv) < 1e-30) pv = A[k * n + k] = 1e-30;
        for (let i = k + 1; i < n; i++) { const f = A[i * n + k] / pv; if (f) { for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j]; z[i] -= f * z[k]; } }
      }
      const x = new Float64Array(n);
      for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j]; x[i] = s / A[i * n + i]; }
      return x;
    }
    if (n > 0) {
      for (let it = 0; it < 60; it++) {
        const conv = stampAll(), x = lu();
        let md = 0, bad = false;
        for (let i = 0; i < n; i++) { if (!isFinite(x[i])) { bad = true; break; } md = Math.max(md, Math.abs(x[i] - V[i])); }
        if (bad) { V.fill(0); for (const s of st.values()) { s.vj = 0; s.vbe = 0; s.vbc = 0; } break; }
        V = x; if (conv && md < 1e-6) break;
      }
    }

    // Currents, heat and failures.
    for (const el of els) {
      const s = S(el.o.id), pr = propsOf(el.o), name = el.o.id;
      if (s.failed) { s.I = 0; s.P = 0; continue; }
      const heat = (ratio, rate) => { if (ratio > 1) s.heat += (ratio - 1) * dt * rate; else s.heat = Math.max(0, s.heat - dt * 0.2); };
      const pd = (a, b) => vn(a) - vn(b);
      switch (el.type) {
        case 'resistor': { const v = pd(el.k('1'), el.k('2')); s.Vd = v; s.I = v / pr.R; s.P = s.I * s.I * pr.R; heat(s.P / pr.P, 0.8); if (s.heat >= 1) fail(el.o, `burned out: ${(s.P).toFixed(2)} W in a ${pr.P} W resistor.`); break; }
        case 'buzzer': {
          const v = pd(el.k('+'), el.k('−')); s.Vd = v; s.I = v / 330;
          heat(v < -1 ? (-v - 1) * 2 + 1 : 0, 0.6);
          if (s.heat >= 1) fail(el.o, `burned out: driven backwards at ${v.toFixed(1)} V. Active buzzers have a + leg.`);
          break;
        }
        case 'cap': {
          const g = (pr.C * 1e-6) / dt, v = pd(el.k('+'), el.k('−')); s.I = g * (v - s.vc); s.vc = v; s.Vd = v;
          const over = Math.max(0, Math.abs(v) - pr.Vmax), rev = v < -1 ? -v - 1 : 0, stress = Math.max(over, rev);
          if (stress > 0) s.heat += stress * dt * 0.5; else s.heat = Math.max(0, s.heat - dt * 0.1);
          if (s.heat >= 1) fail(el.o, rev > over ? `burst: charged backwards to ${v.toFixed(1)} V. Electrolytic capacitors are polarised: + goes to the higher voltage.` : `burst: ${Math.abs(v).toFixed(1)} V across a ${pr.Vmax} V capacitor.`);
          break;
        }
        case 'ledc': case 'diode': {
          const v = pd(el.k('A'), el.k('K')); s.Vd = v; s.I = dcalc(v, dpar(el.type === 'ledc', pr.color))[0];
          heat(Math.abs(s.I) / pr.Imax, 1.5);
          if (s.heat >= 1) fail(el.o, `burst: ${fmtA(s.I)} through ${el.type === 'ledc' ? 'an LED' : 'a diode'} rated for ${fmtA(pr.Imax)}. Add a resistor in series.`);
          break;
        }
        case 'ledmod': { const v = vn(el.m) - vn(el.b); s.Vd = v; s.I = dcalc(v, dpar(true, 'red'))[0]; break; }
        case 'relay': { const p = partOf.get(el.o.id); s.on = !!p?.powered && vn(el.k('IN')) - vn(el.k('GND')) > Math.max(1.5, p.volts * 0.4); break; }
        case 'lamp': { s.I = (vn(el.k('L1')) - vn(el.k('L2')) - 12) / 48; s.P = s.I * s.I * 48; break; }
        case 'npn': {
          const nb = el.k('B'), nc = el.k('C'), ne = el.k('E');
          const q = qcalc(vn(nb) - vn(ne), vn(nb) - vn(nc), Math.max(pr.beta, 1));
          s.Ib = q.Ib; s.Ic = q.Ic; s.I = q.Ic; s.Vd = vn(nc) - vn(ne);
          s.P = q.Ib * vn(nb) + q.Ic * vn(nc) - (q.Ib + q.Ic) * vn(ne);
          heat(Math.max(s.P / pr.Pmax, Math.abs(q.Ic) / 0.8, Math.abs(q.Ib) / 0.1), 0.8);
          if (s.heat >= 1) fail(el.o, Math.abs(q.Ib) > 0.1 ? `burned out: ${fmtA(q.Ib)} into the base. Nothing limited the base current.` : `overheated: ${s.P.toFixed(2)} W in a transistor rated for ${pr.Pmax} W.`);
          break;
        }
        default: break;
      }
      s.name = name;
    }
    // The trip builds up like a fuse heating, so a capacitor's charging rush or a part popping does not trip it.
    let supply = 0; for (const [a, volts] of powerNodes) supply = Math.max(supply, (volts - vn(a)) / R_PWR);
    tripHeat = supply > TRIP_AMPS ? tripHeat + (supply / TRIP_AMPS - 1) * dt : Math.max(0, tripHeat - dt);
    if (tripHeat > 0.3) { tripAmps = supply; tripUntil = now + 1200; lastTrip = now; tripHeat = 0; }
    // A GPIO pin can only source or sink a few tens of milliamps.
    const limit = GPIO_LIMIT[B.id];
    for (const [g, lv] of Object.entries(gpioLevel)) {
      const a = gpioNode[g], I = (lv - vn(a)) / R_GPIO, k = `gpio${g}`;
      if (Math.abs(I) > limit) { if (!warned.has(k)) { warned.add(k); onWarn?.(`Pin ${B.code(+g)} is ${I > 0 ? 'sourcing' : 'sinking'} ${fmtA(I)}; the ${B.name} handles about ${fmtA(limit)} per pin. Add a resistor or drive it through a transistor.`); } }
      else if (Math.abs(I) < limit * 0.6) warned.delete(k);
      const ratio = Math.abs(I) / (limit * 1.5), h = Math.max(0, (pinHeat.get(+g) || 0) + (ratio > 1 ? (ratio - 1) * dt * 0.5 : -dt * 0.2));
      pinHeat.set(+g, h);
      if (h >= 1 && !dead.has(+g)) { dead.add(+g); onFail?.(null, `pin ${B.code(+g)} burned out after carrying ${fmtA(I)}. That pin no longer drives anything.`, { type: 'pin', gpio: +g }); }
    }
    return { gpioNode, B };

    function fail(o, msg) {
      const s = S(o.id); s.failed = true; s.heat = 1; s.I = 0; s.vc = 0;
      onFail?.(o, msg, { type: o.type === 'led' ? 'ledmod' : o.type });
    }
  }

  let lastInfo = null;
  const step = () => { lastInfo = solve(); return lastInfo; };
  const nodeV = (g) => { const { gpioNode } = step(); const a = gpioNode[g]; return a == null || a < 0 ? 0 : V[a]; };
  return {
    step,
    digital(g) { const v = nodeV(g); return v > BOARDS[get().layout.board].logic * 0.5 ? 1 : 0; },
    analog(g) { const v = nodeV(g); return Math.max(0, Math.min(1, v / BOARDS[get().layout.board].logic)); },
    part: (id) => st.get(id),
    repair(id) { const s = st.get(id); if (s) Object.assign(s, { failed: false, heat: 0, vc: 0, vj: 0 }); },
    board: () => ({ shorted, dead: [...dead], heat: pinHeat }),
    repairBoard() { dead.clear(); pinHeat.clear(); warned.clear(); },
    reset() { st.clear(); warned.clear(); dead.clear(); pinHeat.clear(); shorted = false; tripUntil = 0; tripReported = false; tripHeat = 0; V = new Float64Array(0); },
  };
}

export const ledColor = (o) => LEDC[propsOf(o).color]?.c || '#ff4433';
