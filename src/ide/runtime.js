// Sketch runtime for ESP32, Arduino Uno/Mega and Pico: turns an Arduino-style C++ sketch into async JavaScript and runs it against
// simulated pins, sensors, an SSD1306 display and a serial port. It covers the common teaching subset,
// not full C++: setup/loop, functions, globals, arrays, Serial, GPIO, ADC, pulseIn and Adafruit_SSD1306.

/* ---------- transpiler ---------- */
const TYPE = '(?:unsigned\\s+long\\s+long|unsigned\\s+long|unsigned\\s+int|unsigned\\s+char|long\\s+long|int|long|short|float|double|bool|boolean|byte|char|String|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|word)';

export function transpile(src) {
  let s = src.replace(/\r/g, '');
  s = s.replace(/^[ \t]*#include.*$/gm, '');
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+(.+)$/gm, 'const $1 = $2;');
  s = s.replace(/^[ \t]*#.*$/gm, '');
  // Library objects are provided by the runtime, so their declarations go.
  s = s.replace(/^[ \t]*(?:Adafruit_SSD1306|Adafruit_SH1106G?)\s+\w+\s*(\([^;]*\))?\s*;/gm, '');
  s = s.replace(/^([ \t]*)Servo[ \t]+([\w \t,]+);/gm, (m, ind, list) => `${ind}const ${list.split(',').map((n) => `${n.trim()} = __servo()`).join(', ')};`);
  s = s.replace(/^([ \t]*)DHT[ \t]+(\w+)[ \t]*\(([^)]*)\)[ \t]*;/gm, '$1const $2 = __dht($3);');
  // Functions become async so delay() can pause without freezing the page.
  const names = [];
  s = s.replace(new RegExp(`\\b(?:void|${TYPE})\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g'), (m, name, params) => {
    names.push(name);
    const args = params.trim() === 'void' ? '' : params.split(',').map((p) => p.trim().split(/\s+/).pop().replace(/[&*[\]]/g, '')).filter(Boolean).join(', ');
    return `async function ${name}(${args}) {${'\n'.repeat((m.match(/\n/g) || []).length)}`;
  });
  s = s.replace(new RegExp(`\\bconst\\s+${TYPE}\\s+`, 'g'), 'const ');
  s = s.replace(new RegExp(`\\b(?:static\\s+|volatile\\s+)*${TYPE}\\s*\\*?\\s+(?=[A-Za-z_]\\w*\\s*(?:=|;|,|\\[|\\)))`, 'g'), 'let ');
  s = s.replace(/\b(let|const)\s+(\w+)\s*\[\s*\w*\s*\]\s*=\s*\{([^}]*)\}/g, '$1 $2 = [$3]');
  s = s.replace(/\blet\s+(\w+)\s*\[\s*(\w+)\s*\]\s*;/g, 'let $1 = new Array($2).fill(0);');
  s = s.replace(new RegExp(`\\(\\s*${TYPE}\\s*\\)\\s*`, 'g'), '');
  s = s.replace(/\.length\(\)/g, '.length');
  const blocking = ['delay', 'delayMicroseconds', 'pulseIn', ...names];
  s = s.replace(new RegExp(`(?<![\\w.])(?<!function\\s+)(${blocking.join('|')})\\s*\\(`, 'g'), 'await $1(');
  if (!names.includes('setup') || !names.includes('loop')) throw new Error('A sketch needs both void setup() and void loop().');
  return s;
}

/* ---------- SSD1306 128x64 ---------- */
function createDisplay(onShow, i2cOk, warn) {
  const W = 128, H = 64;
  const work = document.createElement('canvas'); work.width = W; work.height = H;
  const g = work.getContext('2d', { willReadFrequently: true });
  let size = 1, color = 1, cx = 0, cy = 0, began = false;
  const shown = new Uint8Array(W * H);
  const ink = (c) => (c ? '#fff' : '#000');
  function clearDisplay() { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); cx = 0; cy = 0; }
  clearDisplay();
  function text(str) {
    g.font = `${8 * size}px "Geist Mono Variable", Consolas, monospace`; g.textBaseline = 'top';
    for (const ch of String(str)) {
      if (ch === '\n') { cx = 0; cy += 8 * size; continue; }
      if (cx + 6 * size > W) { cx = 0; cy += 8 * size; }
      g.fillStyle = ink(color); g.fillText(ch, cx, cy - size * 0.5, 5 * size); cx += 6 * size;
    }
  }
  const api = {
    begin() { began = i2cOk(); if (!began) warn('SSD1306 not found at 0x3C: check the OLED SDA, SCL, VCC and GND wires.'); clearDisplay(); return began; },
    clearDisplay,
    display() {
      // One bit per pixel, like the real panel.
      const d = g.getImageData(0, 0, W, H).data;
      for (let i = 0; i < W * H; i++) shown[i] = d[i * 4] > 110 ? 1 : 0;
      onShow(shown, began && i2cOk());
    },
    setTextSize(n) { size = Math.max(1, Math.round(n)); },
    setTextColor(c) { color = c; },
    setCursor(x, y) { cx = x; cy = y; },
    setTextWrap() {}, cp437() {}, setRotation() {}, dim() {},
    print: (v, f) => text(fmt(v, f)), println: (v = '', f) => text(fmt(v, f) + '\n'),
    drawPixel(x, y, c = 1) { g.fillStyle = ink(c); g.fillRect(Math.round(x), Math.round(y), 1, 1); },
    drawLine(x0, y0, x1, y1, c = 1) {
      let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
      x0 = Math.round(x0); y0 = Math.round(y0); g.fillStyle = ink(c);
      for (let n = 0; n < 512; n++) { g.fillRect(x0, y0, 1, 1); if (x0 === Math.round(x1) && y0 === Math.round(y1)) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    },
    drawFastHLine(x, y, w, c = 1) { g.fillStyle = ink(c); g.fillRect(x, y, w, 1); },
    drawFastVLine(x, y, h, c = 1) { g.fillStyle = ink(c); g.fillRect(x, y, 1, h); },
    drawRect(x, y, w, h, c = 1) { g.fillStyle = ink(c); g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h); },
    fillRect(x, y, w, h, c = 1) { g.fillStyle = ink(c); g.fillRect(x, y, w, h); },
    drawCircle(x, y, r, c = 1) { g.strokeStyle = ink(c); g.lineWidth = 1; g.beginPath(); g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); g.stroke(); },
    fillCircle(x, y, r, c = 1) { g.fillStyle = ink(c); g.beginPath(); g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); g.fill(); },
    drawRoundRect(x, y, w, h, r, c = 1) { api.drawRect(x, y, w, h, c); },
    fillRoundRect(x, y, w, h, r, c = 1) { api.fillRect(x, y, w, h, c); },
    invertDisplay() {}, width: () => W, height: () => H, getCursorX: () => cx, getCursorY: () => cy,
  };
  return api;
}

/* ---------- formatting like Arduino Print ---------- */
function fmt(v, f) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (Number.isInteger(v) && [2, 8, 16].includes(f)) return (v >>> 0).toString(f).toUpperCase();
    if (!Number.isInteger(v)) return v.toFixed(typeof f === 'number' ? f : 2);
    return String(v);
  }
  return String(v);
}
function printf(f, ...a) {
  let i = 0;
  return String(f).replace(/%(-?\d*)(?:\.(\d+))?([disfuxXc%])/g, (m, w, p, t) => {
    if (t === '%') return '%';
    const v = a[i++];
    let s = t === 'f' ? Number(v).toFixed(p ? +p : 6) : t === 'x' ? (v >>> 0).toString(16) : t === 'X' ? (v >>> 0).toString(16).toUpperCase() : t === 'c' ? String.fromCharCode(v) : t === 's' ? String(v) : String(Math.trunc(v));
    const n = Math.abs(+w || 0); return w.startsWith('-') ? s.padEnd(n) : s.padStart(n);
  });
}

class Stop extends Error {}

/** Names a sketch can use without declaring them (the checker uses this to spot wrong capital letters). */
export const SKETCH_NAMES = ['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'analogReadResolution', 'analogSetAttenuation',
  'delay', 'delayMicroseconds', 'millis', 'micros', 'pulseIn', 'map', 'constrain', 'random', 'randomSeed', 'abs', 'min', 'max', 'sqrt', 'pow', 'sq',
  'sin', 'cos', 'floor', 'ceil', 'round', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN', 'LED_BUILTIN', 'DEC', 'HEX', 'BIN', 'OCT',
  'SSD1306_WHITE', 'SSD1306_BLACK', 'SSD1306_INVERSE', 'WHITE', 'BLACK', 'SSD1306_SWITCHCAPVCC', 'Serial', 'Wire', 'display',
  'Servo', 'DHT', 'DHT11', 'DHT22', 'isnan', 'attach', 'detach', 'writeMicroseconds', 'readTemperature', 'readHumidity'];

/**
 * hooks: board (from boards.js), io { digital(g), analog(g), echo(g), i2c() }, onSerial(text, kind, baud), onShow(bits, on)
 * io answers null when nothing on the bench drives that pin.
 */
export function createRuntime(hooks) {
  const pins = {}; // gpio -> { mode, value, pwm }
  const B = hooks.board, io = hooks.io;
  let stopped = false, start = 0, baud = 0;
  const fell = {}; // gpio -> time of the last HIGH->LOW edge, for HC-SR04 triggers
  const input = [];
  const warned = new Set();
  const warn = (msg) => { if (!warned.has(msg)) { warned.add(msg); hooks.onSerial(`[sim] ${msg}\n`, 'warn'); } };
  const check = () => { if (stopped) throw new Stop(); };
  const sleep = (ms) => new Promise((res, rej) => { const id = setTimeout(() => (stopped ? rej(new Stop()) : res()), Math.max(0, ms)); timers.add(id); });
  const timers = new Set();
  const noise = (n) => Math.round((Math.random() - 0.5) * 2 * n);
  const pin = (p) => (pins[p] ||= { mode: null, value: 0, pwm: null });
  const valid = (p, what) => { if (!B.gpios.includes(p)) { warn(`Pin ${p} does not exist on the ${B.name} (${what}).`); return false; } return true; };

  const Serial = {
    begin(b) { baud = b; },
    print: (v, f) => { check(); hooks.onSerial(fmt(v, f), 'out', baud); },
    println: (v = '', f) => { check(); hooks.onSerial(fmt(v, f) + '\n', 'out', baud); },
    printf: (f, ...a) => { check(); hooks.onSerial(printf(f, ...a), 'out', baud); },
    write: (v) => hooks.onSerial(typeof v === 'number' ? String.fromCharCode(v) : String(v), 'out', baud),
    available: () => input.length,
    read: () => (input.length ? input.shift().charCodeAt(0) : -1),
    peek: () => (input.length ? input[0].charCodeAt(0) : -1),
    readString: () => input.splice(0).join(''),
    readStringUntil: (c) => { const end = input.indexOf(typeof c === 'number' ? String.fromCharCode(c) : c); const out = input.splice(0, end < 0 ? input.length : end + 1); if (end >= 0) out.pop(); return out.join(''); },
    parseInt: () => parseInt(input.splice(0).join(''), 10) || 0,
    parseFloat: () => parseFloat(input.splice(0).join('')) || 0,
    flush() {},
  };
  // Strings get the Arduino String helpers they lean on most.
  if (!String.prototype.toInt) {
    Object.defineProperties(String.prototype, {
      toInt: { value() { return parseInt(this, 10) || 0; } }, toFloat: { value() { return parseFloat(this) || 0; } },
      equals: { value(o) { return String(this) === String(o); } },
    });
  }

  function digitalRead(p) {
    check();
    const v = io.digital(p); if (v != null) return v;
    const st = pins[p];
    if (!st || !st.mode) warn(`digitalRead(${p}) before pinMode(${p}, INPUT).`);
    return st?.mode === 'INPUT_PULLUP' ? 1 : st?.value ? 1 : 0;
  }
  function analogRead(p) {
    check();
    if (!B.adcPins.includes(p)) warn(`analogRead(${p}): that pin has no ADC on the ${B.name}. Use ${B.adcPins.map(B.code).slice(0, 4).join(', ')}…`);
    const f = io.analog(p), max = B.adcMax, n = max / 400;
    const raw = f == null ? (pins[p]?.value ? max : Math.random() * n * 3) : f * max + noise(n * 3);
    return Math.max(0, Math.min(max, Math.round(raw)));
  }
  function digitalWrite(p, v) {
    check(); if (!valid(p, 'digitalWrite')) return;
    if (B.inputOnly.includes(p)) { warn(`GPIO ${p} is input-only; digitalWrite does nothing.`); return; }
    const s = pin(p); if (s.mode !== 'OUTPUT') warn(`digitalWrite(${p}) without pinMode(${p}, OUTPUT).`);
    const hi = v ? 1 : 0;
    if (s.value === 1 && !hi) fell[p] = performance.now();
    s.value = hi; s.pwm = null;
  }
  async function pulseIn(p, state = 1, timeout = 1000000) {
    check();
    const e = io.echo(p);
    const wait = Math.min(timeout / 1000, 38);
    if (!e) { await sleep(wait); return 0; }
    if (!e.powered) { warn('The HC-SR04 is not powered: wire VCC and GND.'); await sleep(wait); return 0; }
    const now = performance.now();
    if (!e.trig.some((g) => now - (fell[g] ?? -1e9) < 60)) { warn('pulseIn on ECHO without a TRIG pulse: set TRIG HIGH for 10 µs, then LOW, on the pin wired to TRIG.'); await sleep(wait); return 0; }
    const d = e.distance;
    if (d < 2 || d > 400) { await sleep(wait); return 0; }
    const us = d * 58.3 + noise(15);
    await sleep(us / 1000); return Math.max(0, Math.round(us));
  }

  const display = createDisplay(hooks.onShow, () => io.i2c(), warn);
  // Servo library: write(angle) moves the horn of a servo whose SIG is wired to the attached pin.
  function __servo() {
    let at = null, angle = 90;
    const set = (a) => { angle = Math.max(0, Math.min(180, Math.round(a))); if (at != null) pin(at).servo = angle; };
    return {
      attach(p) { check(); if (!valid(p, 'Servo.attach')) return 0; at = p; Object.assign(pin(p), { mode: 'SERVO', servo: angle }); return 1; },
      detach() { if (at != null) pin(at).mode = null; at = null; },
      write(a) { check(); if (at == null) warn('Servo.write before attach(pin): the servo does not know which pin to use.'); set(a); },
      writeMicroseconds(us) { set(((us - 544) / (2400 - 544)) * 180); },
      read: () => angle, attached: () => at != null,
    };
  }
  // DHT library: temperature and humidity from the DHT11 wired to that pin, or NaN when it does not answer.
  function __dht(p, type = 11) {
    const read = (key) => {
      check();
      const d = io.dht?.(p);
      if (!d || !d.powered) { warn(`The DHT on pin ${p} is not answering: check its DATA, VCC and GND wires.`); return NaN; }
      const v = d[key] + (Math.random() - 0.5) * 0.4;
      return type === 22 ? Math.round(v * 10) / 10 : Math.round(v);
    };
    return { begin() {}, readTemperature: (f) => { const t = read('temp'); return f ? t * 1.8 + 32 : t; }, readHumidity: () => read('hum'), computeHeatIndex: (t) => t };
  }
  const api = {
    Serial, display, Wire: { begin() {}, setClock() {} }, __servo, __dht, DHT11: 11, DHT22: 22, isnan: Number.isNaN,
    pinMode(p, m) { check(); if (!valid(p, 'pinMode')) return; if (m === 'OUTPUT' && B.inputOnly.includes(p)) warn(`GPIO ${p} is input-only and cannot be an OUTPUT.`); pin(p).mode = m; },
    digitalWrite, digitalRead, analogRead,
    analogWrite(p, v) { check(); if (!valid(p, 'analogWrite')) return; const s = pin(p); s.pwm = Math.max(0, Math.min(255, v)); s.value = s.pwm > 0 ? 1 : 0; },
    analogReadResolution() {}, analogSetAttenuation() {},
    delay: (ms) => { check(); return sleep(ms); }, delayMicroseconds: (us) => { check(); return us >= 1000 ? sleep(us / 1000) : Promise.resolve(); },
    millis: () => Math.floor(performance.now() - start), micros: () => Math.floor((performance.now() - start) * 1000),
    pulseIn,
    map: (x, a, b, c, d) => Math.trunc(((x - a) * (d - c)) / (b - a) + c),
    constrain: (x, a, b) => Math.min(b, Math.max(a, x)),
    random: (a, b) => (b === undefined ? Math.floor(Math.random() * a) : Math.floor(a + Math.random() * (b - a))),
    randomSeed() {}, abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, pow: Math.pow, sq: (x) => x * x,
    sin: Math.sin, cos: Math.cos, floor: Math.floor, ceil: Math.ceil, round: Math.round, F: (s) => s,
    HIGH: 1, LOW: 0, INPUT: 'INPUT', OUTPUT: 'OUTPUT', INPUT_PULLUP: 'INPUT_PULLUP', INPUT_PULLDOWN: 'INPUT_PULLDOWN',
    LED_BUILTIN: B.ledBuiltin, ...B.aliases,
    DEC: 10, HEX: 16, BIN: 2, OCT: 8,
    SSD1306_WHITE: 1, SSD1306_BLACK: 0, SSD1306_INVERSE: 2, WHITE: 1, BLACK: 0, SSD1306_SWITCHCAPVCC: 2,
  };

  async function run(source) {
    const code = transpile(source);
    const names = Object.keys(api);
    const factory = new Function(...names, `${code}\n;return { setup, loop };`);
    const { setup, loop } = factory(...names.map((n) => api[n]));
    start = performance.now();
    try {
      await setup();
      while (!stopped) { await loop(); await sleep(0); }
    } catch (err) {
      if (err instanceof Stop) return;
      throw err;
    }
  }

  return {
    pins, run,
    get baud() { return baud; },
    send(text) { for (const ch of text) input.push(ch); },
    stop() { stopped = true; for (const id of timers) clearTimeout(id); },
  };
}

/** Line number of a runtime error inside the sketch, if the engine reports one. */
export function errorLine(err) {
  const m = /<anonymous>:(\d+):\d+/.exec(err?.stack || '');
  return m ? Math.max(1, +m[1] - 2) : null;
}
