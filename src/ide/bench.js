// Wiring bench: an infinite grid where a board, sensor modules and a power rail sit, joined by
// jumper wires dragged from pin to pin. Drawing only; the netlist lives in boards.js.
import { touchUI } from '../platform.js';
import { BOARDS, MODULES, NO_POWER_LED, PARTS, def, fmtR, pinsOf, propsOf, railHoles, resizeRail, size } from './boards.js';
import { LEDC } from '../models.js';
import { previewRouter, routeAll } from './router.js';

const G = 20;
const FONT = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const SIGNAL_COLORS = ['#e6e6e6', '#5aa9ff', '#5fd38d', '#f0a043', '#c58cff', '#4fd1c5', '#ff8fb1'];

/**
 * opts.getLayout() / setLayout(next, gestureKey) / endGesture(), opts.live() -> { pins, oled, powered: Map(objId -> bool), env }
 * opts.onSelect(sel) where sel is { kind: 'obj'|'wire', id } or null; opts.onPress(id, down) for push buttons
 */
export function createWiringBench(cv, opts) {
  const ctx = cv.getContext('2d');
  const cam = { x: -600, y: -320, z: 1 };
  let tool = 'select'; // 'select' draws a box on empty space; 'pan' moves the view wherever you drag
  let hover = null, wiring = null, drag = null, pan = null, sel = null, group = { objs: new Set(), wires: new Set() }, marquee = null, raf = 0, active = true, mouse = null, pressed = null, clock = 0;
  let railGrip = null, gripHover = null; // rail being resized, rail whose grip is under the pointer
  const gripAt = (wx, wy) => layout().objects.find((o) => o.type === 'rail' && Math.abs(wx / G - (o.x + railHoles(o) + 1.3)) < 0.8 && wy / G > o.y - 0.8 && wy / G < o.y + 1.8);
  const C = { bg: '#0a0a0a', dot: '#262626', major: '#454545', line: '#7a7a7a', ink: '#ececec', faint: '#8a8a8a', accent: '#f4f4f4', ok: '#5fd38d', warn: '#f0a043', danger: '#ef5b4c', pcb: '#141414' };
  const layout = () => opts.getLayout();

  function readTokens() {
    const root = cv.closest('.mh-root'); if (!root) return;
    const cs = getComputedStyle(root);
    // Text colour and glow come from the Settings menu (see textStyle in App.jsx).
    const t = cs.getPropertyValue('--cb-text').trim(), tf = cs.getPropertyValue('--cb-text-faint').trim();
    C.text = t || C.ink; C.textFaint = tf || C.faint; C.glow = root.hasAttribute('data-cb-glow');
    for (const [k, v] of [['accent', '--mh-accent'], ['ok', '--mh-ok'], ['warn', '--mh-warn'], ['danger', '--mh-danger']]) { const s = cs.getPropertyValue(v).trim(); if (s) C[k] = s; }
  }

  /* ---------- geometry ---------- */
  const allPins = () => layout().objects.flatMap(pinsOf);
  const pinByKey = (k) => allPins().find((p) => p.key === k);
  function hitPin(wx, wy) {
    let best = null, bd = 0.45;
    for (const p of allPins()) { const d = Math.hypot(wx / G - p.ax, wy / G - p.ay); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function hitObj(wx, wy) {
    const os = layout().objects;
    for (let i = os.length - 1; i >= 0; i--) {
      const o = os[i], d = size(o), x = wx / G - o.x, y = wy / G - o.y;
      const pad = o.type === 'rail' || !d.w || !d.h ? 0.6 : 0;
      if (x >= -pad && x <= d.w + pad && y >= -pad && y <= d.h + pad) return o;
    }
    return null;
  }
  // Orthogonal route: a one-square stub straight out of each pin, then sharp 90° turns between the stubs.
  function wirePath(a, b, lane = 0) {
    const [dx1, dy1] = DIR[a.side] || [0, -1], [dx2, dy2] = DIR[b.side] || [0, -1];
    const p1 = [a.ax * G, a.ay * G], p2 = [b.ax * G, b.ay * G];
    const s1 = [p1[0] + dx1 * G, p1[1] + dy1 * G], s2 = [p2[0] + dx2 * G, p2[1] + dy2 * G];
    const pts = [p1, s1];
    if (s1[0] !== s2[0] && s1[1] !== s2[1]) {
      if (dx1 === 0 && dx2 === 0) { const my = dy1 === dy2 ? (dy1 < 0 ? Math.min(s1[1], s2[1]) : Math.max(s1[1], s2[1])) : (s1[1] + s2[1]) / 2; const y = Math.round(my / G) * G; pts.push([s1[0], y], [s2[0], y]); }
      else if (dy1 === 0 && dy2 === 0) { const mx = dx1 === dx2 ? (dx1 < 0 ? Math.min(s1[0], s2[0]) : Math.max(s1[0], s2[0])) : (s1[0] + s2[0]) / 2; const x = Math.round(mx / G) * G; pts.push([x, s1[1]], [x, s2[1]]); }
      else {
        // One stub vertical, one horizontal. An L works unless its first leg would double back into the part;
        // then step out along each stub to a lane of its own and go round.
        const [v, h, dv, dh] = dx1 === 0 ? [s1, s2, [dx1, dy1], [dx2, dy2]] : [s2, s1, [dx2, dy2], [dx1, dy1]];
        const backV = (h[1] - v[1]) * dv[1] < 0, backH = (v[0] - h[0]) * dh[0] < 0;
        let mid;
        if (!backV) mid = [[v[0], h[1]]];
        else if (!backH) mid = [[h[0], v[1]]];
        else {
          const ov = (lane % 3) * G / 2, oh = (lane % 6) * G / 2;
          const rv = [v[0], v[1] + dv[1] * ov], rh = [h[0] + dh[0] * oh, h[1]];
          mid = [rv, [rh[0], rv[1]], rh];
        }
        pts.push(...(dx1 === 0 ? mid : mid.reverse()));
      }
    }
    pts.push(s2, p2);
    return pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  }
  // Full routes are cached per layout; while a part is being dragged, wires fall back to the quick route.
  let routeCache = { layout: null, map: null };
  function routedPath(w, i) {
    const L = layout();
    if (!drag && routeCache.layout !== L) routeCache = { layout: L, map: routeAll(L) };
    const r = !drag && routeCache.map?.get(w.id);
    if (r) return r.map(([x, y]) => [x * G, y * G]);
    const a = pinByKey(w.a), b = pinByKey(w.b);
    return a && b ? wirePath(a, b, i) : null;
  }
  function makePreview(skipId) {
    const L = layout();
    if (routeCache.layout !== L) routeCache = { layout: L, map: routeAll(L) };
    return previewRouter(L, routeCache.map, skipId);
  }
  const segDist = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return Math.hypot(px - ax - u * dx, py - ay - u * dy); };
  function hitWire(wx, wy) {
    let best = null, bd = 6 / cam.z;
    for (const w of layout().wires) {
      const P = routedPath(w, layout().wires.indexOf(w)); if (!P) continue;
      for (let i = 1; i < P.length; i++) { const d = segDist(wx, wy, P[i - 1], P[i]); if (d < bd) { bd = d; best = w; } }
    }
    return best;
  }
  const strokePath = (P) => { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.stroke(); };
  function wireColor(w, i) {
    const a = pinByKey(w.a), b = pinByKey(w.b);
    if ([a, b].some((p) => p?.kind === 'power')) return '#e25545';
    if ([a, b].some((p) => p?.kind === 'gnd')) return '#5c5c5c';
    return SIGNAL_COLORS[i % SIGNAL_COLORS.length];
  }

  /* ---------- drawing ---------- */
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  function chamfer(x, y, w, h, c) { ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath(); }
  // Labels follow the text colour setting; with glow on, every label gets a halo in its own colour.
  function text(s, x, y, size = 9, color = C.faint, align = 'left', weight = 400) {
    const col = color === C.faint ? C.textFaint || color : color === C.ink ? C.text || color : color;
    ctx.save(); ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (C.glow) { ctx.shadowColor = col; ctx.shadowBlur = 6; }
    ctx.fillText(s, x, y); ctx.restore();
  }

  function drawGrid(w, h) {
    const x0 = Math.floor(cam.x / G), x1 = Math.ceil((cam.x + w / cam.z) / G), y0 = Math.floor(cam.y / G), y1 = Math.ceil((cam.y + h / cam.z) / G);
    ctx.lineWidth = 1 / cam.z;
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      if (i % 5 === 0 && j % 5 === 0) { ctx.strokeStyle = C.major; line(i * G - 3, j * G, i * G + 3, j * G); line(i * G, j * G - 3, i * G, j * G + 3); }
      else if (cam.z > 0.45) { ctx.fillStyle = C.dot; ctx.fillRect(i * G - 0.75, j * G - 0.75, 1.5, 1.5); }
    }
  }

  function drawBoard(o, live) {
    const b = BOARDS[o.type], x = o.x * G, y = o.y * G, w = b.w * G, h = b.h * G, isSel = group.objs.has(o.id);
    ctx.save();
    chamfer(x, y, w, h, 14); ctx.fillStyle = C.pcb; ctx.fill();
    ctx.strokeStyle = isSel ? C.accent : C.line; ctx.lineWidth = isSel ? 1.6 : 1; if (isSel) { ctx.shadowColor = C.accent; ctx.shadowBlur = 10; } ctx.stroke(); ctx.shadowBlur = 0;
    // Chip, USB and label, placed for vertical (ESP32, Pico) or horizontal (Uno, Mega) boards.
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    if (b.usbTop) {
      // SuperMini: USB-C on the top edge, chip in the middle, the name split over two lines.
      ctx.strokeRect(x + w / 2 - 18, y - 4, 36, 14);
      ctx.strokeRect(x + w * 0.24, y + h * 0.36, w * 0.52, w * 0.52);
      text(b.chip, x + w / 2, y + h * 0.36 + w * 0.26, 8.5, C.faint, 'center');
      const [n1, n2] = b.name.split(' ');
      text(n1.toUpperCase(), x + w / 2, y + h - G * 1.6, 9, C.ink, 'center', 600); text((n2 || '').toUpperCase(), x + w / 2, y + h - G * 0.8, 8.5, C.faint, 'center');
    } else if (b.orient === 'v') {
      ctx.strokeRect(x + w * 0.28, y + G * 0.6, w * 0.44, G * 3.2);
      ctx.strokeRect(x + w / 2 - 22, y + h - 16, 44, 16);
      text(b.chip, x + w / 2, y + G * 2.2, 9, C.faint, 'center');
      text(b.name.toUpperCase(), x + w / 2, y + h / 2, 10, C.ink, 'center', 600);
    } else {
      ctx.strokeRect(x - 6, y + G * 2, G * 3, G * 3.4);
      ctx.strokeRect(x - 4, y + h - G * 5, G * 2.6, G * 3);
      ctx.strokeRect(x + w * 0.42, y + h * 0.38, G * 7, G * 3);
      text(b.chip, x + w * 0.42 + G * 3.5, y + h * 0.38 + G * 1.5, 9, C.faint, 'center');
      text(b.name.toUpperCase(), x + w * 0.42 + G * 3.5, y + h * 0.38 - G, 11, C.ink, 'center', 600);
    }
    // Onboard LED follows LED_BUILTIN.
    const led = live?.pins?.[b.ledBuiltin]?.value;
    const lx = b.usbTop ? x + w - G * 1.6 : b.orient === 'v' ? x + w - G * 2.2 : x + G * 6, ly = b.usbTop ? y + G * 1.4 : b.orient === 'v' ? y + G * 4.6 : y + G * 2.5;
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = led ? '#ffb347' : '#262626';
    if (led) { ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 12; } ctx.fill(); ctx.shadowBlur = 0;
    text('L', lx + 8, ly, 8);
    if (live?.board?.dead?.length) { const c = chipOf(o); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 18, 11, 0, 0, Math.PI * 2); ctx.fill(); }
    if (live?.board?.shorted) {
      chamfer(x, y, w, h, 14); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      const c = chipOf(o); ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
      text('NO POWER · SHORT', x + w / 2, y + h * 0.62, 10, C.danger, 'center', 700);
    }
    ctx.restore();
    for (const p of pinsOf(o)) drawPin(p, live, b);
    for (const g of live?.board?.dead || []) {
      const p = pinsOf(o).find((q) => q.kind === 'gpio' && q.gpio === g); if (!p) continue;
      ctx.save(); ctx.strokeStyle = C.danger; ctx.lineWidth = 1.8; line(p.ax * G - 6, p.ay * G - 6, p.ax * G + 6, p.ay * G + 6); line(p.ax * G + 6, p.ay * G - 6, p.ax * G - 6, p.ay * G + 6); ctx.restore();
    }
  }

  function drawPin(p, live, b) {
    const x = p.ax * G, y = p.ay * G, st = p.kind === 'gpio' ? live?.pins?.[p.gpio] : null;
    const high = st && st.mode === 'OUTPUT' && st.value;
    const isHover = hover && hover.key === p.key, isWireEnd = wiring && wiring.from.key === p.key;
    ctx.save();
    ctx.fillStyle = high ? C.accent : p.kind === 'power' ? '#3a1d1a' : p.kind === 'gnd' ? '#1f1f1f' : '#0c0c0c';
    ctx.strokeStyle = isHover || isWireEnd ? C.accent : p.kind === 'power' ? '#a8443a' : p.kind === 'nc' ? '#333' : C.line;
    if (high || isHover) { ctx.shadowColor = C.accent; ctx.shadowBlur = 8; }
    ctx.fillRect(x - 4.5, y - 4.5, 9, 9); ctx.lineWidth = 1; ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
    ctx.restore();
    if (b && cam.z > 0.55) {
      const [dx, dy] = DIR[p.side]; const label = p.label || p.name;
      if (dx) text(label, x - dx * 9, y, 8.5, high ? C.ink : C.faint, dx > 0 ? 'right' : 'left');
      else { ctx.save(); ctx.translate(x, y - dy * 9); ctx.rotate(-Math.PI / 2); text(label, 0, 0, 8.5, high ? C.ink : C.faint, dy > 0 ? 'left' : 'right'); ctx.restore(); }
    }
  }

  const BANDS = ['#111', '#8b4a1c', '#e0352b', '#f08a24', '#f2d33c', '#2fae4e', '#2f6fe0', '#9b4fd8', '#8a8a8a', '#f2f2f2'];
  function bands(R) { const e = Math.floor(Math.log10(R)) - 1; return [Math.floor(R / 10 ** (e + 1)) % 10, Math.floor(R / 10 ** e) % 10, Math.max(0, e)]; }

  // Two-lead parts are drawn along the line between their leads, so they work flat or upright.
  function drawAxial(o, live) {
    const [p1, p2] = pinsOf(o), x1 = p1.ax * G, y1 = p1.ay * G, x2 = p2.ax * G, y2 = p2.ay * G, L = Math.hypot(x2 - x1, y2 - y1), c = L / 2;
    const s = live?.circuit?.get(o.id) || {}, pr = propsOf(o), isSel = group.objs.has(o.id);
    const ink = s.failed ? '#4a4a4a' : isSel ? C.accent : C.ink;
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (isSel) { ctx.shadowColor = C.accent; ctx.shadowBlur = 8; }
    switch (o.type) {
      case 'resistor': {
        line(0, 0, c - 20, 0); line(c + 20, 0, L, 0);
        const hot = !s.failed && s.heat > 0.05;
        ctx.fillStyle = s.failed ? '#141414' : hot ? `rgba(240,120,40,${0.25 + s.heat * 0.6})` : '#cdb48a';
        ctx.beginPath(); ctx.roundRect(c - 20, -7, 40, 14, 6); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        if (!s.failed) { const [d1, d2, m] = bands(pr.R); [[c - 12, d1], [c - 5, d2], [c + 2, m], [c + 12, 10]].forEach(([bx, d]) => { ctx.fillStyle = d === 10 ? '#c9a227' : BANDS[d]; ctx.fillRect(bx, -6.5, 3.5, 13); }); }
        else { ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.ellipse(c, 0, 16, 9, 0, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'ledc': case 'diode': {
        line(0, 0, c - 9, 0); line(c + 9, 0, L, 0);
        const lc = o.type === 'ledc' ? (LEDC[pr.color]?.c || '#f43') : null, br = !s.failed && s.I > 0 ? Math.min(1, s.I / 0.02) : 0;
        if (lc && br > 0.01) { ctx.save(); ctx.shadowBlur = 0; const g = ctx.createRadialGradient(c, 0, 2, c, 0, 42); g.addColorStop(0, lc); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = Math.min(1, br * 0.95); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, 0, 42, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        ctx.beginPath(); ctx.moveTo(c - 9, -9); ctx.lineTo(c - 9, 9); ctx.lineTo(c + 9, 0); ctx.closePath();
        if (s.failed) { ctx.fillStyle = '#151515'; ctx.fill(); } else if (lc) { ctx.save(); ctx.globalAlpha = 0.15 + br * 0.85; ctx.fillStyle = lc; ctx.fill(); ctx.restore(); }
        ctx.stroke(); line(c + 9, -9, c + 9, 9);
        if (lc) { ctx.lineWidth = 1.1; for (const off of [-4, 3]) { line(c + off, -12, c + off + 6, -19); line(c + off + 6, -19, c + off + 2, -18.5); } }
        if (s.failed) { ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c - 7, -6); ctx.lineTo(c - 1, 1); ctx.lineTo(c - 4, 4); ctx.lineTo(c + 3, 8); ctx.stroke(); }
        break;
      }
      case 'cap': {
        line(0, 0, c - 4, 0); line(c + 5, 0, L, 0);
        if (s.failed) {
          ctx.lineWidth = 2.6; ctx.save(); ctx.translate(c, 0); ctx.rotate(-0.5); line(-4, -12, -4, 10); ctx.restore(); ctx.save(); ctx.translate(c, 0); ctx.rotate(0.55); line(6, -10, 6, 12); ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.ellipse(c, 0, 15, 11, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        if (s.heat > 0.02) { const k = 1 + s.heat * 0.4, j = reduceMotion ? 0 : (Math.random() - 0.5) * s.heat * 3; ctx.translate(c + j, j * 0.5); ctx.scale(k, k); ctx.translate(-c, 0); ctx.save(); ctx.globalAlpha = Math.min(0.45, s.heat * 0.5); ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(c, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        const q = Math.min(1, Math.abs(s.vc || 0) / 5);
        if (q > 0.01) { ctx.save(); ctx.globalAlpha = 0.15 + q * 0.5; ctx.fillRect(c - 3, -11 + 22 * (1 - q), 7, 22 * q); ctx.restore(); }
        ctx.lineWidth = 2.6; line(c - 4, -12, c - 4, 12);
        ctx.beginPath(); ctx.moveTo(c + 7, -12); ctx.quadraticCurveTo(c + 1, 0, c + 7, 12); ctx.stroke();
        ctx.lineWidth = 1.2; line(c - 15, -12, c - 9, -12); line(c - 12, -15, c - 12, -9);
        break;
      }
    }
    ctx.restore();
    const upright = Math.abs(y2 - y1) > Math.abs(x2 - x1);
    const val = o.type === 'resistor' ? fmtR(pr.R) : o.type === 'cap' ? `${pr.C} µF` : o.type === 'ledc' ? pr.color : '1N4148';
    const label = `${live?.labels?.get(o.id) || ''} ${val}${s.failed ? ' / FAIL' : ''}`.toUpperCase();
    if (upright) text(label, x1 + 16, (y1 + y2) / 2, 8.5, s.failed ? C.danger : C.faint, 'left');
    else text(label, (x1 + x2) / 2, y1 - 18, 8.5, s.failed ? C.danger : C.faint, 'center');
    for (const p of pinsOf(o)) drawPin(p, live, null);
  }

  const DIALS = ['pot', 'ldr', 'soil', 'sonar', 'dht']; // parts that turn with the scroll wheel once selected
  const servoNow = new Map(); // servo id -> angle the horn shows now
  function drawPart(o, live) {
    if (PARTS[o.type].axial) { drawAxial(o, live); return; }
    const P = PARTS[o.type], x = o.x * G, y = o.y * G, w = size(o).w * G, h = P.h * G, isSel = group.objs.has(o.id);
    const powered = live?.powered?.get(o.id), env = live?.env?.[o.id] || {};
    ctx.save();
    if (o.type === 'rail') {
      ctx.fillStyle = '#121212'; ctx.fillRect(x, y - G * 0.6, w, G * 2.2);
      ctx.strokeStyle = isSel ? C.accent : C.line; ctx.lineWidth = 1; ctx.strokeRect(x, y - G * 0.6, w, G * 2.2);
      ctx.strokeStyle = '#a8443a'; line(x + 6, y - G * 0.45, x + w - 6, y - G * 0.45);
      ctx.strokeStyle = '#555'; line(x + 6, y + G * 1.45, x + w - 6, y + G * 1.45);
      text('+', x - 8, y, 11, '#e25545', 'center', 700); text('−', x - 8, y + G, 11, C.faint, 'center', 700);
      // Grip on the right end: drag it to make the rail longer or shorter.
      const gx = x + w, hot = isSel || railGrip?.id === o.id || gripHover === o.id;
      ctx.fillStyle = hot ? C.accent : '#3a3a3a'; for (let k = 0; k < 3; k++) ctx.fillRect(gx + 3 + k * 3, y - 2, 1.5, G + 4);
      if (hot) text(`${railHoles(o)} HOLES`, gx + 16, y + G / 2, 8.5, C.faint, 'left');
      ctx.restore();
      for (const p of pinsOf(o)) { const px = p.ax * G, py = p.ay * G, hv = hover?.key === p.key; ctx.fillStyle = hv ? C.accent : '#050505'; ctx.fillRect(px - 3, py - 3, 6, 6); ctx.strokeStyle = hv ? C.accent : '#3a3a3a'; ctx.strokeRect(px - 3, py - 3, 6, 6); }
      return;
    }
    chamfer(x, y, w, h, 8); ctx.fillStyle = '#101010'; ctx.fill();
    ctx.strokeStyle = isSel ? C.accent : C.line; ctx.lineWidth = isSel ? 1.6 : 1; if (isSel) { ctx.shadowColor = C.accent; ctx.shadowBlur = 10; } ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
    const cx = x + w / 2;
    switch (o.type) {
      case 'pir': {
        const on = powered && env.motion;
        ctx.beginPath(); ctx.arc(cx, y + G * 2, G * 1.3, 0, Math.PI * 2); ctx.fillStyle = on ? 'rgba(255,255,255,.18)' : '#161616'; ctx.fill(); ctx.stroke();
        for (let i = -1; i <= 1; i++) line(cx + i * 7, y + G * 1.1, cx + i * 7, y + G * 2.9);
        break;
      }
      case 'sonar': for (const ox of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + ox * G * 1.9, y + G * 2, G * 1.3, 0, Math.PI * 2); ctx.fillStyle = '#161616'; ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + ox * G * 1.9, y + G * 2, G * 0.6, 0, Math.PI * 2); ctx.stroke(); } break;
      case 'soil': { ctx.beginPath(); ctx.moveTo(x + 10, y + G * 1.2); ctx.lineTo(x + w - 10, y + G * 1.2); ctx.lineTo(x + w - 10, y + G * 5); ctx.lineTo(cx, y + G * 6.2); ctx.lineTo(x + 10, y + G * 5); ctx.closePath(); ctx.stroke(); const lvl = (env.moisture ?? 0) / 100; ctx.fillStyle = 'rgba(90,169,255,.35)'; ctx.fillRect(x + 11, y + G * 5 - G * 3.7 * lvl, w - 22, G * 3.7 * lvl); break; }
      case 'ldr': { ctx.beginPath(); ctx.arc(cx, y + G * 2, G * 0.9, 0, Math.PI * 2); const l = (env.light ?? 0) / 100; ctx.fillStyle = `rgba(255,220,120,${0.1 + l * 0.6})`; ctx.fill(); ctx.stroke(); ctx.beginPath(); for (let i = 0; i < 5; i++) ctx.lineTo(cx - 10 + i * 5, y + G * 2 + (i % 2 ? 4 : -4)); ctx.stroke(); break; }
      case 'ir': { for (const ox of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + ox * 12, y + G * 1.6, 7, 0, Math.PI * 2); ctx.fillStyle = ox < 0 ? '#202838' : '#111'; ctx.fill(); ctx.stroke(); } if (powered && env.obstacle) { ctx.beginPath(); ctx.arc(cx, y + G * 3.2, 3, 0, Math.PI * 2); ctx.fillStyle = C.ok; ctx.shadowColor = C.ok; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0; } break; }
      case 'oled': {
        const sx = x + 10, sy = y + 8, sw = w - 20, sh = sw / 2;
        ctx.fillStyle = '#030405'; ctx.fillRect(sx, sy, sw, sh); ctx.strokeRect(sx, sy, sw, sh);
        const bits = powered && live?.oled?.on ? live.oled.bits : null;
        if (bits) { const pw = sw / 128, ph = sh / 64; ctx.fillStyle = '#e8f4ff'; for (let j = 0; j < 64; j++) for (let i = 0; i < 128; i++) if (bits[j * 128 + i]) ctx.fillRect(sx + i * pw, sy + j * ph, pw + 0.05, ph + 0.05); }
        break;
      }
      case 'npn': {
        const s = live?.circuit?.get(o.id) || {}, on = !s.failed && Math.abs(s.Ic || 0) > 0.001;
        ctx.beginPath(); ctx.arc(cx, y + h * 0.62, G * 1.2, Math.PI, 0); ctx.closePath(); ctx.fillStyle = s.failed ? '#0a0a0a' : on ? 'rgba(255,255,255,.14)' : '#161616'; ctx.fill(); ctx.stroke();
        text('NPN', cx, y + h * 0.48, 8, C.faint, 'center'); break;
      }
      case 'button': {
        const down = env.pressed; ctx.strokeRect(x + 8, y + 8, w - 16, h - 22);
        ctx.beginPath(); ctx.arc(cx, y + (h - 14) / 2 + 4, G * 0.55, 0, Math.PI * 2); ctx.fillStyle = down ? C.accent : '#222'; if (down) { ctx.shadowColor = C.accent; ctx.shadowBlur = 10; } ctx.fill(); ctx.shadowBlur = 0; ctx.stroke(); break;
      }
      case 'toggle': {
        ctx.strokeRect(x + 10, y + 10, w - 20, 10); ctx.fillStyle = env.on ? C.accent : '#666'; ctx.fillRect(env.on ? x + w / 2 : x + 10, y + 10, w / 2 - 10, 10);
        text(env.on ? 'ON' : 'OFF', cx, y + 28, 8, C.faint, 'center'); break;
      }
      case 'pot': {
        const a = Math.PI * (0.75 + 1.5 * ((env.pos ?? 50) / 100));
        ctx.beginPath(); ctx.arc(cx, y + G * 1.8, G * 1.1, 0, Math.PI * 2); ctx.fillStyle = '#161616'; ctx.fill(); ctx.stroke();
        line(cx, y + G * 1.8, cx + Math.cos(a) * G, y + G * 1.8 + Math.sin(a) * G); break;
      }
      case 'buzzer': {
        const s = live?.circuit?.get(o.id) || {}, on = (s.I || 0) > 0.005;
        ctx.beginPath(); ctx.arc(cx, y + G * 1.8, G * 1.2, 0, Math.PI * 2); ctx.fillStyle = '#121212'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, y + G * 1.8, 3, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
        if (on) { for (let r = 0; r < 3; r++) { const k = (clock * 2 + r / 3) % 1; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(cx, y + G * 1.8, G * (1.3 + k * 1.2), -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, y + G * 1.8, G * (1.3 + k * 1.2), Math.PI - 0.6, Math.PI + 0.6); ctx.stroke(); } ctx.globalAlpha = 1; }
        break;
      }
      case 'servo': {
        // The horn swings towards the angle the sketch wrote, at a servo's pace.
        const target = live?.servos?.get(o.id), cur = servoNow.get(o.id) ?? 90;
        const deg = target == null ? cur : cur + Math.max(-6, Math.min(6, target - cur)); servoNow.set(o.id, deg);
        ctx.fillStyle = '#1a2a44'; ctx.fillRect(x + 8, y + 10, w - 16, h - 20); ctx.strokeRect(x + 8, y + 10, w - 16, h - 20);
        const hx = cx - G * 0.8, hy = y + G * 2.2, a = Math.PI - (deg * Math.PI) / 180;
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fillStyle = '#ddd'; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#e8e8e8'; line(hx, hy, hx + Math.cos(a) * G * 1.7, hy - Math.sin(a) * G * 1.7); ctx.lineWidth = 1.2; ctx.strokeStyle = C.ink;
        text(`${Math.round(deg)}°`, x + w - 12, y + h - 14, 8.5, target == null ? C.faint : C.ink, 'right');
        break;
      }
      case 'dht': {
        ctx.fillStyle = '#5aa9ff33'; ctx.fillRect(x + 7, y + 7, w - 14, G * 3.2); ctx.strokeRect(x + 7, y + 7, w - 14, G * 3.2);
        for (let i = 1; i < 4; i++) line(x + 7, y + 7 + i * G * 0.8, x + w - 7, y + 7 + i * G * 0.8);
        text(`${env.temp ?? 0}°C`, cx, y + G * 4.4, 8.5, C.ink, 'center'); text(`${env.hum ?? 0}%`, cx, y + G * 5.2, 8.5, C.faint, 'center');
        break;
      }
      case 'relay': {
        const s = live?.circuit?.get(o.id) || {}, on = !!s.on;
        ctx.fillStyle = '#16324f'; ctx.fillRect(x + G * 4.6, y + 7, G * 3.8, h - 14); ctx.strokeRect(x + G * 4.6, y + 7, G * 3.8, h - 14);
        text('RELAY', x + G * 6.5, y + G * 1.3, 8, C.faint, 'center');
        // Contact arm: from COM it rests on NC, and jumps to NO while the coil is on.
        const com = { x: x + G * 7, y: y + G * 4.2 }, to = on ? { x: x + G * 6, y: y + G * 3 } : { x: x + G * 8, y: y + G * 3 };
        ctx.lineWidth = 2; ctx.strokeStyle = on ? C.accent : C.ink; line(com.x, com.y, to.x, to.y); ctx.lineWidth = 1.2; ctx.strokeStyle = C.ink;
        ctx.beginPath(); ctx.arc(x + G * 1.5, y + G * 2.5, 3, 0, Math.PI * 2); ctx.fillStyle = on ? C.ok : '#2a2a2a'; if (on) { ctx.shadowColor = C.ok; ctx.shadowBlur = 8; } ctx.fill(); ctx.shadowBlur = 0;
        text(on ? 'ON' : 'OFF', x + G * 1.5, y + G * 3.6, 8, on ? C.ok : C.faint, 'center');
        break;
      }
      case 'lamp': {
        const s = live?.circuit?.get(o.id) || {}, br = Math.min(1, Math.abs(s.I || 0) / 0.25);
        const bx = cx, by = y + G * 1.7;
        if (br > 0.05) { const g = ctx.createRadialGradient(bx, by, 2, bx, by, G * 3.2); g.addColorStop(0, `rgba(255,214,120,${0.75 * br})`); g.addColorStop(1, 'rgba(255,214,120,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, G * 3.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.arc(bx, by, G * 1.1, 0, Math.PI * 2); ctx.fillStyle = br > 0.05 ? `rgba(255,226,150,${0.25 + 0.75 * br})` : '#18160f'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); for (let i = 0; i < 5; i++) ctx.lineTo(bx - 8 + i * 4, by + (i % 2 ? -3 : 3)); ctx.stroke();
        text('12 V', cx, y + h - 9, 8, C.faint, 'center');
        break;
      }
      case 'rgb': {
        const [r, g, b] = live?.rgb?.get(o.id) || [0, 0, 0], on = r + g + b > 0.02;
        const col = `rgb(${Math.round(40 + 215 * r)},${Math.round(40 + 215 * g)},${Math.round(40 + 215 * b)})`;
        ctx.beginPath(); ctx.arc(cx, y + G * 1.6, 10, Math.PI, 0); ctx.lineTo(cx + 10, y + G * 2.7); ctx.lineTo(cx - 10, y + G * 2.7); ctx.closePath();
        ctx.fillStyle = on ? col : '#1c1c1c'; if (on) { ctx.shadowColor = col; ctx.shadowBlur = 26; } ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
        break;
      }
      case 'seg7': {
        // Segments a–g in their usual places; lit ones glow red.
        const lit = live?.seg?.get(o.id) || [], sx = cx - G * 1.2, sy = y + G * 1, sw = G * 2.4, sh = G * 2.2, t = 4;
        const segs = [[sx, sy, sx + sw, sy], [sx + sw, sy, sx + sw, sy + sh], [sx + sw, sy + sh, sx + sw, sy + 2 * sh], [sx, sy + 2 * sh, sx + sw, sy + 2 * sh], [sx, sy + sh, sx, sy + 2 * sh], [sx, sy, sx, sy + sh], [sx, sy + sh, sx + sw, sy + sh]];
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(sx - 10, sy - 8, sw + 20, 2 * sh + 16);
        ctx.lineCap = 'round'; ctx.lineWidth = t;
        segs.forEach(([x1, y1, x2, y2], i) => { const on = lit[i] > 0.05; ctx.strokeStyle = on ? '#ff3b2f' : '#2a1110'; if (on) { ctx.shadowColor = '#ff3b2f'; ctx.shadowBlur = 12 * lit[i]; } line(x1, y1, x2, y2); ctx.shadowBlur = 0; });
        ctx.lineWidth = 1.2; ctx.lineCap = 'butt'; ctx.strokeStyle = C.ink;
        break;
      }
      case 'led': {
        const on = live?.leds?.get(o.id);
        ctx.beginPath(); ctx.arc(cx, y + G * 1.5, 9, Math.PI, 0); ctx.lineTo(cx + 9, y + G * 2.6); ctx.lineTo(cx - 9, y + G * 2.6); ctx.closePath();
        ctx.fillStyle = on ? '#ff4433' : '#2a1312'; if (on) { ctx.shadowColor = '#ff4433'; ctx.shadowBlur = 24; } ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
        break;
      }
    }
    // Power LED on each module, like the real breakout boards.
    if (MODULES.includes(o.type) && !NO_POWER_LED.includes(o.type)) { ctx.beginPath(); ctx.arc(x + w - 8, y + 8, 2.5, 0, Math.PI * 2); ctx.fillStyle = powered ? C.danger : '#2a2a2a'; if (powered) { ctx.shadowColor = C.danger; ctx.shadowBlur = 6; } ctx.fill(); ctx.shadowBlur = 0; }
    ctx.restore();
    const pinsUp = P.pins[0]?.side === 'top';
    text((MODULES.includes(o.type) ? P.name : `${live?.labels?.get(o.id) || ''} ${o.type === 'pot' ? fmtR(propsOf(o).R) : P.name}`).toUpperCase(), x, pinsUp ? y + h + 11 : y - 9, 9, C.ink, 'left', 600);
    for (const p of pinsOf(o)) {
      drawPin(p, live, null);
      if (cam.z > 0.55) { const up = p.side === 'top'; ctx.save(); ctx.translate(p.ax * G, p.ay * G + (up ? -9 : 9)); ctx.rotate(-Math.PI / 2); text(p.name, 0, 0, 8, C.faint, up ? 'left' : 'right'); ctx.restore(); }
    }
  }

  function drawWires() {
    const ws = layout().wires;
    ws.forEach((w, i) => {
      if (wiring?.replace?.id === w.id) return;
      const P = routedPath(w, i); if (!P) return;
      const isSel = group.wires.has(w.id), col = wireColor(w, i);
      ctx.save(); ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 5; strokePath(P);
      ctx.strokeStyle = isSel ? C.accent : col; ctx.lineWidth = isSel ? 3 : 2.2; if (isSel) { ctx.shadowColor = C.accent; ctx.shadowBlur = 10; }
      strokePath(P);
      // Bend points marked like solder joints on a schematic.
      ctx.shadowBlur = 0; ctx.fillStyle = isSel ? C.accent : col; for (let k = 1; k < P.length - 1; k++) ctx.fillRect(P[k][0] - 1.5, P[k][1] - 1.5, 3, 3);
      if (isSel) for (const [hx, hy] of [P[0], P[P.length - 1]]) { ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.lineWidth = 1.6; ctx.strokeStyle = C.accent; ctx.setLineDash([]); ctx.stroke(); }
      ctx.restore();
    });
    if (wiring) {
      const a = wiring.from, onPin = hover && hover.key !== a.key;
      const target = onPin ? hover : { ax: Math.round(wiring.x / G), ay: Math.round(wiring.y / G), free: true };
      const path = wiring.preview?.(a, target);
      const P = path ? path.map(([x, y]) => [x * G, y * G]) : wirePath(a, { ax: target.ax, ay: target.ay, side: target.side || (Math.abs(target.ax - a.ax) > Math.abs(target.ay - a.ay) ? (target.ax > a.ax ? 'left' : 'right') : (target.ay > a.ay ? 'top' : 'bottom')) });
      // From the end of the route to the cursor, keep it orthogonal too.
      if (path && !onPin) { const [ex, ey] = P[P.length - 1], cx = wiring.x, cy = wiring.y; if (Math.abs(cx - ex) + Math.abs(cy - ey) > G * 0.6) P.push([cx, ey], [cx, cy]); }
      if (onPin) { ctx.save(); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hover.ax * G, hover.ay * G, 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.lineJoin = 'miter'; strokePath(P); ctx.restore();
    }
  }

  function drawTip(w) {
    if (!hover || !mouse) return;
    const b = BOARDS[layout().board];
    let s = hover.label || hover.name;
    if (hover.obj.kind === 'board') {
      if (hover.kind === 'gpio') s += ` · ${b.id === 'pico' ? 'GP' : b.family === 'esp32' ? 'GPIO ' : 'pin '}${hover.gpio}${hover.adc ? ' · ADC' : ''}${hover.inputOnly ? ' · INPUT ONLY' : ''}`;
      else if (hover.kind === 'power') s += ` · ${hover.volts} V`;
    } else s = `${PARTS[hover.obj.type].name} · ${hover.name}`;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.font = `500 11px ${FONT}`; const tw = ctx.measureText(s).width + 14;
    const x = Math.min(mouse.x + 14, w - tw - 4), y = mouse.y - 26;
    ctx.fillStyle = 'rgba(10,10,10,.92)'; ctx.fillRect(x, y, tw, 20); ctx.strokeStyle = C.line; ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, 19);
    text(s, x + 7, y + 10, 11, C.ink, 'left', 500);
  }


  /* ---------- failure effects: flashes, sparks, smoke, flames, shake ---------- */
  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let particles = [], shakeT = 0, lastFx = 0;
  const flames = new Map(); // part id -> seconds of flame left
  function centerOf(o) {
    if (def(o).axial) { const [p1, p2] = pinsOf(o); return { x: (p1.ax + p2.ax) / 2 * G, y: (p1.ay + p2.ay) / 2 * G }; }
    const sz = size(o); return { x: (o.x + sz.w / 2) * G, y: (o.y + sz.h / 2) * G };
  }
  function chipOf(board) { const b = BOARDS[board.type]; return b.orient === 'v' ? { x: (board.x + b.w / 2) * G, y: (board.y + 2.2) * G } : { x: (board.x + b.w * 0.42 + 3.5) * G, y: (board.y + b.h * 0.38 + 1.5) * G }; }
  const flash = (c, col, size = 70) => { particles.push({ k: 'flash', x: c.x, y: c.y, age: 0, life: 0.3, col, size }, { k: 'ring', x: c.x, y: c.y, age: 0, life: 0.5, size: size * 1.4 }); };
  function sparks(c, count, cols, speed = 220) {
    const n = reduceMotion ? Math.ceil(count / 4) : count;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * speed; particles.push({ k: 'spark', x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90, age: 0, life: 0.5 + Math.random() * 0.7, col: cols[i % cols.length], r: 1.2 + Math.random() * 2.2 }); }
  }
  const puff = (c, delay = 0, r = 4) => particles.push({ k: 'smoke', x: c.x + (Math.random() - 0.5) * 10, y: c.y, vx: (Math.random() - 0.5) * 14, vy: -18 - Math.random() * 22, age: -delay, life: 2.2 + Math.random(), r });
  const smoke = (c, n, r = 4) => { for (let i = 0; i < n; i++) puff(c, i * 0.08, r); };

  function effect(id, info = {}) {
    const L = layout(), board = L.objects.find((o) => o.kind === 'board');
    if (info.type === 'short') {
      const c = chipOf(board); flash(c, '#ffffff', 140); sparks(c, 40, ['#ffb347', '#ffffff', '#ff6a3d'], 320); smoke(c, 16, 7); shakeT = 0.6; return;
    }
    if (info.type === 'pin') {
      const p = pinsOf(board).find((q) => q.kind === 'gpio' && q.gpio === info.gpio); if (!p) return;
      const c = { x: p.ax * G, y: p.ay * G }; flash(c, '#ffb347', 30); sparks(c, 12, ['#ff8a3d', '#ffd27a']); smoke(c, 5); smoke(chipOf(board), 4, 5); shakeT = Math.max(shakeT, 0.12); return;
    }
    const o = L.objects.find((q) => q.id === id); if (!o) return;
    const c = centerOf(o), color = LEDC[propsOf(o).color]?.c || '#ff4433';
    switch (info.type) {
      case 'resistor': flames.set(id, 1.6); sparks(c, 10, ['#ff7a1a', '#ffcf4a']); smoke(c, 8); break;
      case 'ledc': case 'ledmod': flash(c, info.type === 'ledc' ? color : '#ff4433'); sparks(c, 22, [color, '#ffffff', '#ffcf6a']); smoke(c, 6); shakeT = Math.max(shakeT, 0.15); break;
      case 'diode': flash(c, '#ffffff', 50); sparks(c, 16, ['#ffffff', '#ffcf6a']); smoke(c, 6); break;
      case 'cap': flash(c, '#ffd27a', 90); sparks(c, 34, ['#ffffff', '#c9ccd2', '#8a8f98', '#ff6a3d'], 320); smoke(c, 12, 5); shakeT = 0.45; break;
      case 'npn': flash(c, '#ffb07a', 60); sparks(c, 14, ['#ff8a3d', '#ffd27a']); smoke(c, 12); break;
      case 'buzzer': sparks(c, 18, ['#9cc8ff', '#ffffff'], 160); smoke(c, 8); break;
      default: flash(c, '#ffffff', 50); sparks(c, 12, ['#ffffff', '#ffb347']); smoke(c, 6);
    }
  }

  function stepFx(dt, live) {
    for (const p of particles) {
      p.age += dt; if (p.age < 0) continue;
      if (p.k === 'spark') { p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      else if (p.k === 'smoke' || p.k === 'flame') { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    particles = particles.filter((p) => p.age < p.life);
    const L = layout();
    for (const [id, t] of flames) {
      const o = L.objects.find((q) => q.id === id); if (!o || t <= 0) { flames.delete(id); continue; }
      flames.set(id, t - dt); const c = centerOf(o);
      if (Math.random() < 0.8) particles.push({ k: 'flame', x: c.x + (Math.random() - 0.5) * 22, y: c.y, vx: (Math.random() - 0.5) * 10, vy: -40 - Math.random() * 30, age: 0, life: 0.35 + Math.random() * 0.3 });
      if (Math.random() < dt * 6) puff(c);
    }
    // Warning smoke before a part fails, and lingering smoke from a damaged board.
    if (live?.circuit) for (const [id, s] of live.circuit) if (!s.failed && s.heat > 0.2 && Math.random() < s.heat * dt * 5) { const o = L.objects.find((q) => q.id === id); if (o) puff(centerOf(o)); }
    const board = L.objects.find((o) => o.kind === 'board');
    if (board && live?.board?.shorted && Math.random() < dt * 4) puff(chipOf(board), 0, 6);
    if (board && live?.board?.dead?.length && Math.random() < dt * 1.5) puff(chipOf(board), 0, 3);
    if (shakeT > 0) shakeT -= dt;
  }

  function drawFx() {
    for (const p of particles) {
      if (p.age < 0) continue; const f = p.age / p.life;
      ctx.save();
      if (p.k === 'flash') { ctx.globalAlpha = Math.max(0, 1 - f); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 8 + f * p.size, 0, Math.PI * 2); ctx.fill(); }
      else if (p.k === 'ring') { ctx.globalAlpha = Math.max(0, 1 - f); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; const r = 10 + f * p.size; ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2); }
      else if (p.k === 'spark') { ctx.globalAlpha = 1 - f; ctx.fillStyle = p.col; ctx.shadowColor = p.col; ctx.shadowBlur = 6; ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
      else if (p.k === 'smoke') { ctx.globalAlpha = 0.3 * (1 - f); ctx.fillStyle = '#7a7a7a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.age * 14, 0, Math.PI * 2); ctx.fill(); }
      else if (p.k === 'flame') { ctx.globalAlpha = 1 - f; ctx.fillStyle = f < 0.4 ? '#ffd34d' : '#ff6a1a'; ctx.beginPath(); ctx.arc(p.x, p.y, 5 * (1 - f) + 1, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }

  let lastTok = 0;
  function frame(ts) {
    if (!active) { raf = 0; return; }
    clock = (ts || 0) / 1000;
    if (clock - lastTok > 0.5) { readTokens(); lastTok = clock; }
    const fxDt = lastFx ? Math.min(0.05, clock - lastFx) : 0; lastFx = clock;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (w) {
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
      const sx = shakeT > 0 && !reduceMotion ? (Math.random() - 0.5) * 12 * shakeT : 0, sy = shakeT > 0 && !reduceMotion ? (Math.random() - 0.5) * 9 * shakeT : 0;
      ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, (sx - cam.x * cam.z) * dpr, (sy - cam.y * cam.z) * dpr);
      drawGrid(w, h);
      const live = opts.live();
      stepFx(fxDt, live);
      for (const o of layout().objects) (o.kind === 'board' ? drawBoard(o, live) : drawPart(o, live));
      drawWires();
      if (marquee) {
        ctx.save(); ctx.strokeStyle = C.accent; ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1 / cam.z; ctx.setLineDash([5 / cam.z, 4 / cam.z]);
        const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
      }
      drawFx();
      drawTip(w);
    }
    raf = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  const world = (ev) => { const r = cv.getBoundingClientRect(); return { x: cam.x + (ev.clientX - r.left) / cam.z, y: cam.y + (ev.clientY - r.top) / cam.z, sx: ev.clientX - r.left, sy: ev.clientY - r.top }; };
  // `sel` is the single item the panels act on; `group` is everything selected (box, Shift+click, paste).
  const emptyGroup = () => ({ objs: new Set(), wires: new Set() });
  function setSel(s) {
    sel = s; group = emptyGroup();
    if (s?.kind === 'obj') group.objs.add(s.id); else if (s?.kind === 'wire') group.wires.add(s.id);
    opts.onSelect?.(s);
  }
  function setGroup(objs, wires) {
    group = { objs: new Set(objs), wires: new Set(wires) };
    const n = group.objs.size + group.wires.size;
    sel = n === 1 ? (group.objs.size ? { kind: 'obj', id: [...group.objs][0] } : { kind: 'wire', id: [...group.wires][0] }) : null;
    opts.onSelect?.(sel);
  }
  function toggle(kind, id) {
    const objs = new Set(group.objs), wires = new Set(group.wires), set = kind === 'obj' ? objs : wires;
    if (set.has(id)) set.delete(id); else set.add(id);
    setGroup(objs, wires);
  }
  function onDown(ev) {
    cv.setPointerCapture(ev.pointerId); cv.focus({ preventScroll: true });
    const p = world(ev);
    if (ev.button === 1 || ev.button === 2 || tool === 'pan') { pan = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; cv.style.cursor = 'grabbing'; return; }
    const pinHit = hitPin(p.x, p.y);
    const selWire = sel?.kind === 'wire' && layout().wires.find((q) => q.id === sel.id);
    if (selWire && pinHit && (selWire.a === pinHit.key || selWire.b === pinHit.key)) {
      const end = selWire.a === pinHit.key ? 'a' : 'b', fixed = pinByKey(end === 'a' ? selWire.b : selWire.a);
      wiring = { from: fixed, x: p.x, y: p.y, replace: { id: selWire.id, end }, preview: makePreview(selWire.id) }; return;
    }
    if (pinHit) { wiring = { from: pinHit, x: p.x, y: p.y, preview: makePreview(null) }; setSel(null); return; }
    const grip = gripAt(p.x, p.y);
    if (grip) { setSel({ kind: 'obj', id: grip.id }); railGrip = { id: grip.id }; return; }
    const w = hitWire(p.x, p.y);
    if (w) { if (ev.shiftKey) toggle('wire', w.id); else setSel({ kind: 'wire', id: w.id }); return; }
    const o = hitObj(p.x, p.y);
    if (o) {
      if (ev.shiftKey) { toggle('obj', o.id); return; }
      const wasSel = group.objs.size === 1 && group.objs.has(o.id) && !group.wires.size; // parts work once they are selected
      if (!group.objs.has(o.id)) setSel({ kind: 'obj', id: o.id });
      if (o.type === 'button' && wasSel) { pressed = o.id; opts.onPress?.(o.id, true); }
      // Dragging any selected part moves the whole group; wires follow their pins.
      const L = layout(), orig = new Map(L.objects.filter((q) => group.objs.has(q.id)).map((q) => [q.id, { x: q.x, y: q.y }]));
      drag = { gx: p.x / G, gy: p.y / G, orig, dx: 0, dy: 0, wasSel, obj: o }; return;
    }
    // Empty space. Touch: drag draws a selection box (a Pan tool moves the view). Desktop: drag pans, Shift+drag selects.
    if (!touchUI && !ev.shiftKey) { setSel(null); pan = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; return; }
    if (!ev.shiftKey) setSel(null);
    marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, objs: [...group.objs], wires: [...group.wires] };
  }
  function onMove(ev) {
    const p = world(ev); mouse = { x: p.sx, y: p.sy };
    if (pan) { cam.x = pan.cx - (ev.clientX - pan.x) / cam.z; cam.y = pan.cy - (ev.clientY - pan.y) / cam.z; return; }
    if (marquee) { marquee.x1 = p.x; marquee.y1 = p.y; return; }
    hover = hitPin(p.x, p.y);
    if (wiring) { wiring.x = p.x; wiring.y = p.y; return; }
    if (railGrip) {
      const L = layout(), o = L.objects.find((q) => q.id === railGrip.id);
      const n = Math.round(p.x / G - o.x - 1.3);
      if (o && n !== railHoles(o)) opts.setLayout(resizeRail(L, o.id, n), `rail:${o.id}`);
      cv.style.cursor = 'ew-resize'; return;
    }
    gripHover = gripAt(p.x, p.y)?.id || null;
    if (drag) {
      const dx = Math.round(p.x / G - drag.gx), dy = Math.round(p.y / G - drag.gy);
      if (dx !== drag.dx || dy !== drag.dy) {
        drag.dx = dx; drag.dy = dy; const L = layout();
        opts.setLayout({ ...L, objects: L.objects.map((q) => { const o = drag.orig.get(q.id); return o ? { ...q, x: o.x + dx, y: o.y + dy } : q; }) }, 'move:group');
      }
    }
    cv.style.cursor = gripHover ? 'ew-resize' : hover ? 'crosshair' : '';
  }
  function onUp(ev) {
    if (marquee) {
      const m = marquee; marquee = null;
      const x0 = Math.min(m.x0, m.x1) / G, x1 = Math.max(m.x0, m.x1) / G, y0 = Math.min(m.y0, m.y1) / G, y1 = Math.max(m.y0, m.y1) / G;
      if ((x1 - x0) * G < 4 && (y1 - y0) * G < 4) return; // a click, not a box
      const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const L = layout();
      const objs = L.objects.filter((o) => { const z = size(o), cx = o.x + z.w / 2, cy = o.y + z.h / 2; return inBox(cx, cy); }).map((o) => o.id);
      const wires = L.wires.filter((w) => { const a = pinByKey(w.a), b = pinByKey(w.b); return a && b && inBox(a.ax, a.ay) && inBox(b.ax, b.ay); }).map((w) => w.id);
      setGroup([...new Set([...m.objs, ...objs])], [...new Set([...m.wires, ...wires])]);
      return;
    }
    if (wiring) {
      const p = world(ev), to = hitPin(p.x, p.y), from = wiring.from, re = wiring.replace; wiring = null;
      if (re) {
        const L = layout(), w = L.wires.find((q) => q.id === re.id);
        const dup = to && L.wires.some((q) => q.id !== re.id && ((q.a === from.key && q.b === to.key) || (q.a === to.key && q.b === from.key)));
        if (w && to && to.key !== from.key && to.key !== w[re.end] && !dup) opts.setLayout({ ...L, wires: L.wires.map((q) => (q.id === re.id ? { ...q, [re.end]: to.key } : q)) });
        setSel({ kind: 'wire', id: re.id });
      } else if (to && to.key !== from.key) {
        const L = layout();
        const dup = L.wires.some((w) => (w.a === from.key && w.b === to.key) || (w.a === to.key && w.b === from.key));
        if (!dup) { const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; opts.setLayout({ ...L, wires: [...L.wires, { id, a: from.key, b: to.key }] }); setSel({ kind: 'wire', id }); }
      }
    }
    if (pressed) { opts.onPress?.(pressed, false); pressed = null; }
    // A click (no drag) on a part that was already selected uses it: flip a switch, wave at the PIR …
    if (drag?.wasSel && !drag.dx && !drag.dy && !drag.moved) opts.onInteract?.(drag.obj, 'click');
    if (drag || railGrip) opts.endGesture?.();
    railGrip = null;
    drag = null; pan = null; cv.style.cursor = '';
  }
  const ZMIN = 0.25;
  function cancelGesture() { if (pressed) { opts.onPress?.(pressed, false); pressed = null; } if (drag || railGrip) opts.endGesture?.(); drag = null; marquee = null; wiring = null; pan = null; railGrip = null; }

  // Touch: two fingers pan and pinch-zoom the bench whatever tool is picked. A second finger cancels the
  // one-finger gesture the first finger started.
  const touches = new Map(); let pinch = null;
  function pinchStart() {
    const [a, b] = [...touches.values()], r = cv.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z, wx: cam.x + mx / cam.z, wy: cam.y + my / cam.z };
  }
  function pinchMove() {
    const [a, b] = [...touches.values()], r = cv.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const z = Math.max(ZMIN, Math.min(3, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
    cam.z = z; cam.x = pinch.wx - mx / z; cam.y = pinch.wy - my / z;
  }
  function tDown(ev) {
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) { cancelGesture(); pinchStart(); return; }
      if (touches.size > 2) return;
    }
    if (!pinch) onDown(ev);
  }
  function tMove(ev) {
    if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) { if (touches.size === 2) pinchMove(); return; }
    onMove(ev);
  }
  function tUp(ev) {
    touches.delete(ev.pointerId);
    if (pinch) { if (touches.size < 2) pinch = null; return; }
    onUp(ev);
  }

  function onWheel(ev) {
    ev.preventDefault(); const p = world(ev);
    // Scrolling on a selected knob or sensor turns it instead of zooming.
    const o = hitObj(p.x, p.y);
    if (o && group.objs.size === 1 && group.objs.has(o.id) && DIALS.includes(o.type)) { opts.onInteract?.(o, 'wheel', ev.deltaY < 0 ? 1 : -1, ev.shiftKey); return; }
    const z = Math.max(0.25, Math.min(3, cam.z * Math.exp(-ev.deltaY * 0.0015)));
    cam.x = p.x - p.sx / z; cam.y = p.y - p.sy / z; cam.z = z;
  }
  const onLeave = () => { hover = null; mouse = null; };
  const onMenu = (e) => e.preventDefault();
  cv.addEventListener('pointerdown', tDown); cv.addEventListener('pointermove', tMove); cv.addEventListener('pointerup', tUp); cv.addEventListener('pointercancel', tUp);
  cv.addEventListener('pointerleave', onLeave); cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('contextmenu', onMenu);
  readTokens();

  /** Frame the whole bench, or with partsOnly just the parts and the rail holes in use. */
  function fit(partsOnly = false) {
    const ps = allPins(); const os = layout().objects;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // The rail is long; only the holes that are wired count towards the view.
    const used = new Set(layout().wires.flatMap((w) => [w.a, w.b]));
    for (const o of os) {
      if (partsOnly && o.kind === 'board') continue;
      if (o.type === 'rail') { for (const p of pinsOf(o)) if (used.has(p.key)) { x0 = Math.min(x0, p.ax - 1); x1 = Math.max(x1, p.ax + 1); y0 = Math.min(y0, p.ay - 1); y1 = Math.max(y1, p.ay + 1); } continue; }
      const d = size(o); x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y - 1); x1 = Math.max(x1, o.x + d.w); y1 = Math.max(y1, o.y + d.h + 1); }
    if (!ps.length) return;
    const w = cv.clientWidth || 800, h = cv.clientHeight || 500, pad = 3;
    cam.z = Math.max(0.25, Math.min(1.5, Math.min(w / ((x1 - x0 + pad * 2) * G), h / ((y1 - y0 + pad * 2) * G))));
    cam.x = ((x0 + x1) / 2) * G - w / 2 / cam.z; cam.y = ((y0 + y1) / 2) * G - h / 2 / cam.z;
  }

  return {
    fit, effect, get zoom() { return cam.z; },
    get tool() { return tool; }, setTool(t) { tool = t === 'pan' ? 'pan' : 'select'; cv.style.cursor = tool === 'pan' ? 'grab' : ''; },
    zoomBy(f) { const w = cv.clientWidth / 2, h = cv.clientHeight / 2, wx = cam.x + w / cam.z, wy = cam.y + h / cam.z; cam.z = Math.max(0.25, Math.min(3, cam.z * f)); cam.x = wx - w / cam.z; cam.y = wy - h / cam.z; },
    get selection() { return sel; }, select: setSel, setGroup,
    get group() { return { objs: [...group.objs], wires: [...group.wires] }; },
    setActive(on) { active = on; if (on && !raf) { readTokens(); raf = requestAnimationFrame(frame); } },
    destroy() {
      active = false; cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('wheel', onWheel); cv.removeEventListener('contextmenu', onMenu);
    },
  };
}
