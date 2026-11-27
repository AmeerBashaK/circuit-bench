// Orthogonal wire router for the Maker IDE bench. Wires are routed one after another on the grid with A*.
// A wire may cross another at a right angle, but never shares a segment with it, never passes through a
// part body, an unrelated pin or another wire's corner (both would look like a connection), and only
// steps over the power rail when it has to.
import { def, pinsOf, size } from './boards.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SIDE_DIR = { right: 0, bottom: 1, left: 2, top: 3 };
const COST = { step: 1, bend: 4, cross: 2, rail: 6, overlap: 30 };
const MAX_EXPAND = 150000;
const k = (x, y) => `${x},${y}`;

class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * Returns Map(wireId -> [[gx, gy], ...]) in grid units, pin to pin. Wires it cannot route are left out.
 * Earlier wires can fence later ones in, so failed wires are moved to the front and everything is re-routed.
 */
export function routeAll(layout) {
  let order = layout.wires, best = null;
  for (let pass = 0; pass < 4; pass++) {
    const r = routeOnce(layout, order);
    if (!best || r.size > best.size) best = r;
    if (r.size === layout.wires.length) break;
    const failed = order.filter((w) => !r.has(w.id));
    order = [...failed, ...order.filter((w) => r.has(w.id))];
  }
  return best;
}

function routeOnce(layout, order) {
  const env = makeEnv(layout), out = new Map();
  for (const w of order) {
    const a = env.pins.get(w.a), b = env.pins.get(w.b); if (!a || !b) continue;
    const path = env.route(a, b);
    if (!path) continue;
    env.markPath(path, [w.a, w.b]); out.set(w.id, path);
  }
  return out;
}

/**
 * Live preview for a wire being dragged: the other wires keep their current routes as obstacles, and only the
 * dragged wire is searched, so it is fast enough to run on every pointer move.
 * Returns (fromPin, target) -> path, where target is a pin or a free grid point { ax, ay, free: true }.
 */
export function previewRouter(layout, routes, skipId) {
  const env = makeEnv(layout);
  for (const w of layout.wires) { const p = routes?.get(w.id); if (p && w.id !== skipId) env.markPath(p, [w.a, w.b]); }
  const memo = new Map();
  return (from, to) => {
    const key = `${from.key}>${to.key || `${to.ax},${to.ay}`}`;
    if (!memo.has(key)) {
      // The cursor may be over a part, where no wire can go: aim for the nearest open grid point instead.
      const t = to.free ? env.nearestOpen(to.ax, to.ay) : to;
      memo.set(key, t ? env.route(from, t, to.free ? 20000 : MAX_EXPAND) : null);
    }
    return memo.get(key);
  };
}

function makeEnv(layout) {
  const blocked = new Set(), rail = new Set(), pinAt = new Map(), pins = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of layout.objects) {
    const sz = size(o), ps = pinsOf(o);
    for (const p of ps) { pins.set(p.key, p); pinAt.set(k(p.ax, p.ay), p.key); }
    x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + sz.w); y1 = Math.max(y1, o.y + sz.h);
    if (o.type === 'rail') { for (const p of ps) rail.add(k(p.ax, p.ay)); continue; }
    if (def(o).axial) {
      const [a, b] = ps, dx = Math.sign(b.ax - a.ax), dy = Math.sign(b.ay - a.ay);
      for (let x = a.ax + dx, y = a.ay + dy; x !== b.ax || y !== b.ay; x += dx, y += dy) blocked.add(k(x, y));
      continue;
    }
    for (let x = o.x; x <= o.x + sz.w; x++) for (let y = o.y; y <= o.y + sz.h; y++) blocked.add(k(x, y));
  }
  const B = { x0: x0 - 16, y0: y0 - 16, x1: x1 + 16, y1: y1 + 16 };
  const usedH = new Map(), usedV = new Map(), corners = new Map(); // key -> Set of pin keys the wire joins
  const edge = (x, y, d) => (d % 2 === 0 ? ['H', k(Math.min(x, x + DIRS[d][0]), y)] : ['V', k(x, Math.min(y, y + DIRS[d][1]))]);
  const add = (m, key, ends) => { if (!m.has(key)) m.set(key, new Set()); for (const e of ends) m.get(key).add(e); };
  const foreign = (m, key, ownKeys) => { const s = m.get(key); if (!s) return false; for (const e of s) if (ownKeys.has(e)) return false; return true; };
  const used = (x, y, d, ownKeys) => { const [t, key] = edge(x, y, d); return foreign(t === 'H' ? usedH : usedV, key, ownKeys); };
  const mark = (x, y, d, ends) => { const [t, key] = edge(x, y, d); add(t === 'H' ? usedH : usedV, key, ends); };

  // Each wired pin's exit stub belongs to that pin, so other wires cannot run along it.
  const reserved = new Map(), wiredPts = new Set();
  for (const w of layout.wires) for (const key of [w.a, w.b]) {
    const p = pins.get(key); if (!p) continue;
    wiredPts.add(k(p.ax, p.ay));
    const d = SIDE_DIR[p.side] ?? 3, [, ek] = edge(p.ax, p.ay, d);
    reserved.set(`${d % 2 ? 'V' : 'H'}${ek}`, k(p.ax, p.ay));
  }
  const markPath = (path, ends) => {
    for (let i = 1; i < path.length; i++) {
      const [px, py] = path[i - 1], [qx, qy] = path[i];
      const d = DIRS.findIndex(([dx, dy]) => dx === Math.sign(qx - px) && dy === Math.sign(qy - py));
      for (let x = px, y = py; x !== qx || y !== qy; x += DIRS[d][0], y += DIRS[d][1]) mark(x, y, d, ends);
      if (i < path.length - 1) add(corners, k(qx, qy), ends);
    }
  };
  const open = (x, y) => !blocked.has(k(x, y)) && !pinAt.has(k(x, y)) && x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1;
  const nearestOpen = (x, y) => {
    for (let r = 0; r < 25; r++) for (let dx = -r; dx <= r; dx++) for (const dy of r ? [-(r - Math.abs(dx)), r - Math.abs(dx)] : [0]) if (open(x + dx, y + dy)) return { ax: x + dx, ay: y + dy, free: true };
    return null;
  };
  return { pins, route, markPath, nearestOpen };

  // Strict first; if the wire is fenced in, allow the least overlap needed so it still lands on 90° turns.
  function route(a, b, budget = MAX_EXPAND) { return search(a, b, false, budget) || search(a, b, true, budget); }

  function search(a, b, relax, budget) {
    const da = SIDE_DIR[a.side] ?? 3, db = SIDE_DIR[b.side] ?? 3;
    const sx = a.ax + DIRS[da][0], sy = a.ay + DIRS[da][1];
    const gx = b.free ? b.ax : b.ax + DIRS[db][0], gy = b.free ? b.ay : b.ay + DIRS[db][1], arrive = b.free ? -1 : (db + 2) % 4;
    const own = new Set([w(a), w(b)]), ownKeys = new Set([a.key, b.key].filter(Boolean));
    function w(p) { return k(p.ax, p.ay); }
    const passable = (x, y, goal) => {
      if (x < B.x0 || x > B.x1 || y < B.y0 || y > B.y1) return false;
      const key = k(x, y);
      if (goal) return true;
      if (blocked.has(key)) return false;
      if (pinAt.has(key) && !own.has(key) && (!rail.has(key) || wiredPts.has(key))) return false;
      return true;
    };
    const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
    const best = new Map(), prev = new Map(), heap = new Heap();
    const start = `${sx},${sy},${da}`;
    best.set(start, 0); heap.push({ x: sx, y: sy, d: da, g: 0, f: h(sx, sy), id: start });
    let expanded = 0, found = null;
    while (heap.size && expanded++ < budget) {
      const n = heap.pop();
      if (n.g > best.get(n.id)) continue;
      if (n.x === gx && n.y === gy) { found = n; break; }
      for (let d = 0; d < 4; d++) {
        if (d === (n.d + 2) % 4) continue;
        const nx = n.x + DIRS[d][0], ny = n.y + DIRS[d][1], goal = nx === gx && ny === gy;
        if (!passable(nx, ny, goal)) continue;
        const busy = used(n.x, n.y, d, ownKeys) || (!goal && foreign(corners, k(nx, ny), ownKeys));
        if (busy && !relax) continue;
        // A wire may hop over an empty rail hole only going straight up or down: never along the row, never turning on it.
        if (rail.has(k(nx, ny)) && !goal && !own.has(k(nx, ny)) && d % 2 === 0) continue;
        if (rail.has(k(n.x, n.y)) && !own.has(k(n.x, n.y)) && d !== n.d) continue;
        const [et, ek] = edge(n.x, n.y, d), owner = reserved.get(`${et}${ek}`);
        if (owner && !own.has(owner) && !relax) continue;
        const key = k(nx, ny);
        let g = n.g + COST.step + (d !== n.d ? COST.bend : 0);
        if (rail.has(key) && !goal) g += COST.rail;
        if (busy) g += COST.overlap;
        if ((d % 2 === 0 ? usedV : usedH).has(key) || usedV.has(k(nx, ny - 1)) || usedH.has(k(nx - 1, ny))) g += COST.cross;
        if (goal && arrive >= 0 && d !== arrive) g += COST.bend;
        const id = `${nx},${ny},${d}`;
        if (g < (best.get(id) ?? Infinity)) { best.set(id, g); prev.set(id, n.id); heap.push({ x: nx, y: ny, d, g, f: g + h(nx, ny), id }); }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let id = found.id; id; id = prev.get(id)) { const [x, y] = id.split(',').map(Number); pts.push([x, y]); }
    pts.reverse();
    const full = b.free ? [[a.ax, a.ay], ...pts] : [[a.ax, a.ay], ...pts, [b.ax, b.ay]];
    // Keep only the corners.
    return full.filter((p, i) => i === 0 || i === full.length - 1 || (full[i - 1][0] - p[0]) * (full[i + 1][1] - p[1]) !== (full[i - 1][1] - p[1]) * (full[i + 1][0] - p[0]));
  }
}
