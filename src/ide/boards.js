// Boards, plug-in parts, the netlist that wires them together, and a starter layout for each board.
// Geometry is in grid squares; every pin sits on a grid point so jumper wires snap cleanly.

const pin = (name, x, y, side, extra = {}) => ({ name, x, y, side, ...extra });
const gp = (name, gpio, x, y, side, extra) => pin(name, x, y, side, { kind: 'gpio', gpio, ...extra });
const pw = (name, x, y, side, volts) => pin(name, x, y, side, { kind: 'power', volts });
const gnd = (name, x, y, side) => pin(name, x, y, side, { kind: 'gnd' });

/* ---------- boards ---------- */
// Default pins for a 7-segment display's a–g, as segA … segG.
const segs = (gs) => Object.fromEntries(gs.map((g, i) => [`seg${'ABCDEFG'[i]}`, g]));
function esp32() {
  const L = [['EN', null], ['VP', 36], ['VN', 39], ['D34', 34], ['D35', 35], ['D32', 32], ['D33', 33], ['D25', 25], ['D26', 26], ['D27', 27], ['D14', 14], ['D12', 12], ['D13', 13], ['GND', 'g'], ['VIN', 'v']];
  const R = [['D23', 23], ['D22', 22], ['TX0', 1], ['RX0', 3], ['D21', 21], ['D19', 19], ['D18', 18], ['D5', 5], ['TX2', 17], ['RX2', 16], ['D4', 4], ['D2', 2], ['D15', 15], ['GND', 'g'], ['3V3', '3']];
  const mk = ([n, g], x, y, side) => (g === 'g' ? gnd(n, x, y, side) : g === 'v' ? pw(n, x, y, side, 5) : g === '3' ? pw(n, x, y, side, 3.3) : g == null ? pin(n, x, y, side, { kind: 'nc' }) : gp(n, g, x, y, side, { adc: g >= 32, inputOnly: [34, 35, 36, 39].includes(g) }));
  return {
    id: 'esp32', name: 'ESP32 DevKit V1', chip: 'ESP-WROOM-32', w: 12, h: 18, orient: 'v',
    pins: [...L.map((p, i) => mk(p, 0, 2 + i, 'left')), ...R.map((p, i) => mk(p, 12, 2 + i, 'right'))],
    adcMax: 4095, ledBuiltin: 2, i2c: { sda: 21, scl: 22 }, logic: 3.3, aliases: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35 },
    code: (g) => String(g), defaults: { pir: 27, trig: 5, echo: 18, soil: 34, ldr: 35, ir: 26, led: 4, button: 13, pot: 32, ledc: 25, servo: 19, dht: 23, relay: 33, rgbR: 17, rgbG: 16, rgbB: 15, ...segs([13, 12, 14, 27, 26, 25, 33]) }, vcc: '3V3',
  };
}
// SuperMini boards: tiny ESP32 variants with the USB-C port at the top end. Pins are listed from the USB end.
function supermini(id, name, chip, left, right, extra) {
  const mk = (p, x, y, side) => (p === '5V' ? pw('5V', x, y, side, 5) : p === '3V3' ? pw('3V3', x, y, side, 3.3) : p === 'GND' ? gnd('GND', x, y, side)
    : gp(p[0], p[1], x, y, side, { adc: extra.adc.includes(p[1]) }));
  const h = Math.max(left.length, right.length) + 2;
  return {
    id, name, chip, w: 8, h, orient: 'v', usbTop: true, family: 'esp32',
    pins: [...left.map((p, i) => mk(p, 0, 2 + i, 'left')), ...right.map((p, i) => mk(p, 8, 2 + i, 'right'))],
    adcMax: 4095, logic: 3.3, code: (g) => String(g), vcc: '3V3', ...extra,
  };
}
function c3() {
  // Front view, USB-C at the top: GPIO 5–10, 20 (RX), 21 (TX) down one side; 5V, GND, 3V3, GPIO 4–0 down the other.
  return supermini('c3', 'ESP32-C3 SuperMini', 'ESP32-C3',
    [['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['RX', 20], ['TX', 21]],
    ['5V', 'GND', '3V3', ['4', 4], ['3', 3], ['2', 2], ['1', 1], ['0', 0]],
    { adc: [0, 1, 2, 3, 4], ledBuiltin: 8, i2c: { sda: 8, scl: 9 }, aliases: { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4 },
      defaults: { pir: 5, trig: 6, echo: 7, soil: 0, ldr: 1, ir: 10, led: 4, button: 10, pot: 2, ledc: 3, servo: 5, dht: 6, relay: 7, rgbR: 5, rgbG: 6, rgbB: 7, ...segs([0, 1, 2, 3, 4, 5, 6]) } });
}
function s3() {
  // Front view, USB-C at the top: TX (43), RX (44), GPIO 1–7 down one side; 5V, GND, 3V3, GPIO 13–8 down the other.
  // The 20 extra pads on the underside (GPIO 14–18, 21, 33–48) are not drawn.
  return supermini('s3', 'ESP32-S3 SuperMini', 'ESP32-S3',
    [['TX', 43], ['RX', 44], ['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7]],
    ['5V', 'GND', '3V3', ['13', 13], ['12', 12], ['11', 11], ['10', 10], ['9', 9], ['8', 8]],
    { adc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], ledBuiltin: 48, i2c: { sda: 8, scl: 9 }, aliases: { A0: 1, A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8, A8: 9, A9: 10 },
      defaults: { pir: 4, trig: 5, echo: 6, soil: 1, ldr: 2, ir: 7, led: 10, button: 11, pot: 3, ledc: 12, servo: 13, dht: 7, relay: 10, rgbR: 11, rgbG: 12, rgbB: 13, ...segs([1, 2, 3, 4, 5, 6, 7]) } });
}
function unoTop(gpioOffset = 0) {
  return [
    ...[['SCL', 19], ['SDA', 18], ['AREF', null], ['GND', 'g'], ['13', 13], ['12', 12], ['~11', 11], ['~10', 10], ['~9', 9], ['8', 8]].map(([n, g], i) => [n, g, 9 + i]),
    ...[['7', 7], ['~6', 6], ['~5', 5], ['4', 4], ['~3', 3], ['2', 2], ['TX', 1], ['RX', 0]].map(([n, g], i) => [n, g, 20 + i]),
  ].map(([n, g, x]) => (g === 'g' ? gnd(n, x, 0, 'top') : g == null ? pin(n, x, 0, 'top', { kind: 'nc' }) : gp(n, g === 18 || g === 19 ? g + gpioOffset : g, x, 0, 'top')));
}
function unoPower(x0, h) {
  return [['IOREF', null], ['RST', null], ['3.3V', 3.3], ['5V', 5], ['GND', 'g'], ['GND', 'g'], ['VIN', 5]].map(([n, v], i) =>
    v === 'g' ? gnd(n, x0 + i, h, 'bottom') : v == null ? pin(n, x0 + i, h, 'bottom', { kind: 'nc' }) : pw(n, x0 + i, h, 'bottom', v));
}
function uno() {
  return {
    id: 'uno', name: 'Arduino Uno R3', chip: 'ATmega328P', w: 30, h: 20, orient: 'h',
    pins: [...unoTop(), ...unoPower(11, 20), ...[0, 1, 2, 3, 4, 5].map((i) => gp(`A${i}`, 14 + i, 19 + i, 20, 'bottom', { adc: true }))],
    adcMax: 1023, ledBuiltin: 13, i2c: { sda: 18, scl: 19 }, logic: 5, aliases: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19 },
    code: (g) => (g >= 14 ? `A${g - 14}` : String(g)), defaults: { pir: 2, trig: 9, echo: 10, soil: 14, ldr: 15, ir: 3, led: 7, button: 4, pot: 16, ledc: 6, servo: 11, dht: 8, relay: 12, rgbR: 9, rgbG: 10, rgbB: 11, ...segs([2, 3, 4, 5, 6, 7, 8]) }, vcc: '5V',
  };
}
function mega() {
  const top = unoTop(2); // Mega's SDA/SCL are 20/21
  const extra = [['TX3', 14], ['RX3', 15], ['TX2', 16], ['RX2', 17], ['TX1', 18], ['RX1', 19], ['SDA', 20], ['SCL', 21]].map(([n, g], i) => gp(n, g, 29 + i, 0, 'top'));
  const dbl = [];
  for (let r = 0; r < 16; r++) { dbl.push(gp(String(22 + r * 2), 22 + r * 2, 45, 2 + r, 'left')); dbl.push(gp(String(23 + r * 2), 23 + r * 2, 48, 2 + r, 'right')); }
  const aliases = {}; for (let i = 0; i < 16; i++) aliases[`A${i}`] = 54 + i;
  return {
    id: 'mega', name: 'Arduino Mega 2560', chip: 'ATmega2560', w: 48, h: 20, orient: 'h',
    pins: [...top, ...extra, ...unoPower(11, 20), ...Array.from({ length: 16 }, (_, i) => gp(`A${i}`, 54 + i, 19 + i, 20, 'bottom', { adc: true })), ...dbl],
    adcMax: 1023, ledBuiltin: 13, i2c: { sda: 20, scl: 21 }, logic: 5, aliases,
    code: (g) => (g >= 54 ? `A${g - 54}` : String(g)), defaults: { pir: 2, trig: 9, echo: 10, soil: 54, ldr: 55, ir: 3, led: 7, button: 4, pot: 56, ledc: 6, servo: 11, dht: 8, relay: 12, rgbR: 9, rgbG: 10, rgbB: 11, ...segs([2, 3, 4, 5, 6, 7, 8]) }, vcc: '5V',
  };
}
function pico() {
  const L = [0, 1, 'G', 2, 3, 4, 5, 'G', 6, 7, 8, 9, 'G', 10, 11, 12, 13, 'G', 14, 15];
  const R = [['VBUS', 'p5'], ['VSYS', 'p5'], ['GND', 'G'], ['3V3_EN', null], ['3V3', 'p3'], ['ADC_VREF', null], ['GP28', 28], ['AGND', 'G'], ['GP27', 27], ['GP26', 26], ['RUN', null], ['GP22', 22], ['GND', 'G'], ['GP21', 21], ['GP20', 20], ['GP19', 19], ['GP18', 18], ['GND', 'G'], ['GP17', 17], ['GP16', 16]];
  const mk = (n, g, x, y, side) => (g === 'G' ? gnd(n, x, y, side) : g === 'p5' ? pw(n, x, y, side, 5) : g === 'p3' ? pw(n, x, y, side, 3.3) : g == null ? pin(n, x, y, side, { kind: 'nc' }) : gp(n, g, x, y, side, { adc: g >= 26 }));
  return {
    id: 'pico', name: 'Raspberry Pi Pico', chip: 'RP2040', w: 9, h: 21, orient: 'v',
    pins: [...L.map((g, i) => mk(g === 'G' ? 'GND' : `GP${g}`, g, 0, 1 + i, 'left')), ...R.map(([n, g], i) => mk(n, g, 9, 1 + i, 'right'))],
    adcMax: 1023, ledBuiltin: 25, i2c: { sda: 4, scl: 5 }, logic: 3.3, aliases: { A0: 26, A1: 27, A2: 28 },
    code: (g) => String(g), defaults: { pir: 15, trig: 16, echo: 17, soil: 26, ldr: 27, ir: 14, led: 13, button: 12, pot: 28, ledc: 11, servo: 18, dht: 19, relay: 20, rgbR: 6, rgbG: 7, rgbB: 8, ...segs([0, 1, 2, 3, 6, 7, 8]) }, vcc: '3V3',
  };
}
export const BOARDS = { esp32: esp32(), c3: c3(), s3: s3(), uno: uno(), mega: mega(), pico: pico() };
export const BOARD_ITEMS = Object.values(BOARDS).map((b) => ({ value: b.id, label: b.name }));
for (const b of Object.values(BOARDS)) {
  // Pin names are keys, so repeated headers (GND, SDA) get a hidden suffix; the label stays as printed.
  const seen = {};
  for (const p of b.pins) { p.label = p.name; seen[p.name] = (seen[p.name] || 0) + 1; if (seen[p.name] > 1) p.name = `${p.name}#${seen[p.name]}`; }
  b.gpios = [...new Set(b.pins.filter((p) => p.kind === 'gpio').map((p) => p.gpio))].filter((g) => !(b.id === 'esp32' && (g === 1 || g === 3))).sort((a, c) => a - c);
  b.inputOnly = b.pins.filter((p) => p.inputOnly).map((p) => p.gpio);
  b.adcPins = [...new Set(b.pins.filter((p) => p.adc).map((p) => p.gpio))];
  if (b.id === 'pico') b.gpios.push(25); // onboard LED, not on the header
  if (b.id === 's3') b.gpios.push(48); // onboard RGB LED, not on the header
  b.family ||= b.id;
}

/* ---------- parts ---------- */
export const PARTS = {
  pir: { name: 'PIR motion', model: 'HC-SR501', w: 5, h: 5, pins: [pw('VCC', 1, 5, 'bottom'), pin('OUT', 2, 5, 'bottom', { kind: 'out' }), gnd('GND', 3, 5, 'bottom')], env: { motion: false } },
  sonar: { name: 'Ultrasonic', model: 'HC-SR04', w: 8, h: 5, pins: [pw('VCC', 2, 5, 'bottom'), pin('TRIG', 3, 5, 'bottom', { kind: 'in' }), pin('ECHO', 4, 5, 'bottom', { kind: 'out' }), gnd('GND', 5, 5, 'bottom')], env: { distance: 42 } },
  soil: { name: 'Soil moisture', model: 'Capacitive v1.2', w: 4, h: 7, pins: [pin('AOUT', 1, 7, 'bottom', { kind: 'aout' }), pw('VCC', 2, 7, 'bottom'), gnd('GND', 3, 7, 'bottom')], env: { moisture: 55 } },
  ldr: { name: 'Light sensor', model: 'LDR module', w: 4, h: 5, pins: [pw('VCC', 1, 5, 'bottom'), gnd('GND', 2, 5, 'bottom'), pin('AOUT', 3, 5, 'bottom', { kind: 'aout' })], env: { light: 70 } },
  ir: { name: 'IR obstacle', model: 'FC-51', w: 4, h: 5, pins: [pin('OUT', 1, 5, 'bottom', { kind: 'out' }), gnd('GND', 2, 5, 'bottom'), pw('VCC', 3, 5, 'bottom')], env: { obstacle: false } },
  oled: { name: 'OLED 0.96"', model: 'SSD1306 I2C', w: 8, h: 5, pins: [gnd('GND', 2, 5, 'bottom'), pw('VCC', 3, 5, 'bottom'), pin('SCL', 4, 5, 'bottom', { kind: 'i2c' }), pin('SDA', 5, 5, 'bottom', { kind: 'i2c' })], env: {} },
  led: { name: 'LED + 220 Ω', model: 'Red 5 mm', w: 3, h: 4, pins: [pin('+', 1, 4, 'bottom', { kind: 'in' }), gnd('−', 2, 4, 'bottom')], env: {} },
  servo: { name: 'Servo', model: 'SG90, 0–180°', w: 6, h: 5, pins: [gnd('GND', 2, 5, 'bottom'), pw('VCC', 3, 5, 'bottom'), pin('SIG', 4, 5, 'bottom', { kind: 'in' })], env: {} },
  dht: { name: 'Temp + humidity', model: 'DHT11', w: 4, h: 6, pins: [pw('VCC', 1, 6, 'bottom'), pin('DATA', 2, 6, 'bottom', { kind: 'out' }), gnd('GND', 3, 6, 'bottom')], env: { temp: 28, hum: 65 } },
  relay: { name: 'Relay', model: '5 V, active HIGH', w: 9, h: 5, pins: [pw('VCC', 1, 5, 'bottom'), gnd('GND', 2, 5, 'bottom'), pin('IN', 3, 5, 'bottom', { kind: 'in' }), pin('NO', 6, 5, 'bottom'), pin('COM', 7, 5, 'bottom'), pin('NC', 8, 5, 'bottom')], env: {} },
  lamp: { name: 'Lamp + 12 V battery', model: '12 V 3 W bulb', w: 5, h: 4, pins: [pin('L1', 1, 4, 'bottom'), pin('L2', 4, 4, 'bottom')], env: {} },
  rgb: { name: 'RGB LED', model: 'Common −, resistors built in', w: 5, h: 4, pins: [pin('R', 1, 4, 'bottom', { kind: 'in' }), pin('G', 2, 4, 'bottom', { kind: 'in' }), pin('B', 3, 4, 'bottom', { kind: 'in' }), gnd('−', 4, 4, 'bottom')], env: {} },
  seg7: { name: '7-segment', model: 'Common cathode, resistors built in', w: 9, h: 7, pins: [...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => pin(n, i + 1, 7, 'bottom', { kind: 'in' })), gnd('COM', 8, 7, 'bottom')], env: {} },
  // Discrete components. Axial parts have a lead at each end and can be turned upright with Rotate.
  resistor: { name: 'Resistor', model: '¼ W', w: 4, h: 0, axial: true, pins: [pin('1', 0, 0, 'left'), pin('2', 4, 0, 'right')], env: {}, props: { R: 220, P: 0.25 } },
  ledc: { name: 'LED', model: '5 mm', w: 3, h: 0, axial: true, pins: [pin('A', 0, 0, 'left'), pin('K', 3, 0, 'right')], env: {}, props: { color: 'red', Imax: 0.03 } },
  diode: { name: 'Diode', model: '1N4148', w: 3, h: 0, axial: true, pins: [pin('A', 0, 0, 'left'), pin('K', 3, 0, 'right')], env: {}, props: { Imax: 0.2 } },
  cap: { name: 'Capacitor', model: 'Electrolytic', w: 3, h: 0, axial: true, pins: [pin('+', 0, 0, 'left'), pin('−', 3, 0, 'right')], env: {}, props: { C: 100, Vmax: 16 } },
  npn: { name: 'Transistor', model: '2N2222 NPN', w: 4, h: 3, pins: [pin('E', 1, 0, 'top'), pin('B', 2, 0, 'top'), pin('C', 3, 0, 'top')], env: {}, props: { beta: 100, Pmax: 0.625 } },
  button: { name: 'Push button', model: '6 mm tactile', w: 3, h: 3, pins: [pin('1', 1, 0, 'top'), pin('2', 2, 0, 'top')], env: { pressed: false } },
  toggle: { name: 'Slide switch', model: 'SPST', w: 3, h: 2, pins: [pin('1', 1, 0, 'top'), pin('2', 2, 0, 'top')], env: { on: false } },
  pot: { name: 'Potentiometer', model: '10 kΩ', w: 4, h: 4, pins: [pin('1', 1, 0, 'top'), pin('W', 2, 0, 'top'), pin('3', 3, 0, 'top')], env: { pos: 50 }, props: { R: 10000 } },
  buzzer: { name: 'Buzzer', model: 'Active 5 V', w: 4, h: 4, pins: [pin('+', 1, 0, 'top'), pin('−', 3, 0, 'top')], env: {} },
  rail: { name: 'Power rail', model: '', w: 53, h: 1, rail: true, pins: [], env: {} },
};
const RAIL_HOLES = 52;
export const RAIL_MIN = 4, RAIL_MAX = 160;
export const RAIL_LENGTHS = [10, 20, 30, 40, 52, 64, 80, 100];
// Each rail has its own length in holes per row, stored as props.holes.
export const railHoles = (o) => Math.max(RAIL_MIN, Math.min(RAIL_MAX, o.props?.holes ?? RAIL_HOLES));
const railPinCache = new Map();
function railPins(n) {
  if (!railPinCache.has(n)) railPinCache.set(n, [
    ...Array.from({ length: n }, (_, i) => pw(`+${i}`, i + 1, 0, 'top')),
    ...Array.from({ length: n }, (_, i) => gnd(`−${i}`, i + 1, 1, 'bottom')),
  ]);
  return railPinCache.get(n);
}
PARTS.rail.pins = railPins(RAIL_HOLES);

/** Change a rail's length; wires plugged into holes that no longer exist are removed with it. */
export function resizeRail(layout, id, holes) {
  const n = Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(holes)));
  const gone = (key) => { const [oid, pin] = key.split(':'); return oid === id && +pin.slice(1) >= n; };
  return {
    ...layout,
    objects: layout.objects.map((o) => (o.id === id ? { ...o, props: { ...o.props, holes: n } } : o)),
    wires: layout.wires.filter((w) => !gone(w.a) && !gone(w.b)),
  };
}
export const MODULES = ['pir', 'sonar', 'soil', 'ldr', 'ir', 'dht', 'oled', 'led', 'rgb', 'seg7', 'servo', 'relay', 'lamp'];
/** Modules without their own power LED (they have no VCC pin). */
export const NO_POWER_LED = ['led', 'rgb', 'seg7', 'lamp'];
export const COMPONENTS = ['resistor', 'ledc', 'diode', 'cap', 'npn', 'button', 'toggle', 'pot', 'buzzer'];
export const RESISTORS = [100, 220, 330, 470, 1000, 2200, 4700, 10000, 47000, 100000];
export const CAPS = [1, 10, 100, 470, 1000, 2200];
export const CAP_VOLTS = [2.5, 4, 6.3, 10, 16, 25];

export function def(obj) { return obj.kind === 'board' ? BOARDS[obj.type] : PARTS[obj.type]; }
const TURN = { left: 'top', right: 'bottom' };
export function pinsOf(obj) {
  const d = def(obj), up = d.axial && obj.rot % 2 === 1;
  return (obj.type === 'rail' ? railPins(railHoles(obj)) : d.pins).map((p) => {
    const x = up ? 0 : p.x, y = up ? p.x : p.y, side = up ? TURN[p.side] : p.side;
    return { ...p, side, key: `${obj.id}:${p.name}`, ax: obj.x + x, ay: obj.y + y, obj };
  });
}
/** Width and height on the grid, after rotation. */
export function size(obj) { const d = def(obj); if (obj.type === 'rail') return { w: railHoles(obj) + 1, h: 1 }; return d.axial && obj.rot % 2 === 1 ? { w: d.h, h: d.w } : { w: d.w, h: d.h }; }
export const propsOf = (obj) => ({ ...PARTS[obj.type]?.props, ...obj.props });

/* ---------- netlist ---------- */
// Union-find over pin keys. Parts add their own internal links: rail strips, a board's GNDs,
// and board pins that share a GPIO (the Uno's A4 and SDA are the same wire).
export function netlist(layout) {
  const parent = new Map();
  const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); parent.set(k, r); return r; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const join = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const all = [];
  for (const o of layout.objects) {
    const ps = pinsOf(o); ps.forEach((p) => { add(p.key); all.push(p); });
    if (o.type === 'rail') { for (let i = 1; i < railHoles(o); i++) { join(`${o.id}:+0`, `${o.id}:+${i}`); join(`${o.id}:−0`, `${o.id}:−${i}`); } }
    if (o.kind === 'board') {
      const gs = ps.filter((p) => p.kind === 'gnd'); gs.forEach((p) => join(gs[0].key, p.key));
      const byG = {}; ps.filter((p) => p.kind === 'gpio').forEach((p) => { (byG[p.gpio] ||= []).push(p.key); });
      Object.values(byG).forEach((ks) => ks.forEach((k) => join(ks[0], k)));
      const byV = {}; ps.filter((p) => p.kind === 'power').forEach((p) => { (byV[p.volts] ||= []).push(p.key); });
      Object.values(byV).forEach((ks) => ks.forEach((k) => join(ks[0], k)));
    }
  }
  for (const w of layout.wires) if (parent.has(w.a) && parent.has(w.b)) join(w.a, w.b);
  const nets = new Map();
  for (const p of all) { const r = find(p.key); if (!nets.has(r)) nets.set(r, []); nets.get(r).push(p); }
  const board = layout.objects.find((o) => o.kind === 'board');
  const netOf = (key) => nets.get(find(key)) || [];
  const boardPins = (key) => netOf(key).filter((p) => p.obj.kind === 'board');
  const gpiosOn = (key) => [...new Set(boardPins(key).filter((p) => p.kind === 'gpio').map((p) => p.gpio))];
  const hasBoard = (key, kind) => boardPins(key).some((p) => p.kind === kind);
  const shorts = [...nets.values()].filter((n) => n.some((p) => p.obj.kind === 'board' && p.kind === 'power') && n.some((p) => p.obj.kind === 'board' && p.kind === 'gnd'));
  const parts = layout.objects.filter((o) => o.kind === 'part' && o.type !== 'rail').map((o) => {
    const ps = pinsOf(o);
    const vcc = ps.find((p) => p.kind === 'power'), g = ps.find((p) => p.kind === 'gnd');
    const volts = vcc ? Math.max(0, ...boardPins(vcc.key).filter((p) => p.kind === 'power').map((p) => p.volts)) : 0;
    const powered = (!vcc || volts > 0) && (!g || hasBoard(g.key, 'gnd')) && !shorts.length;
    const io = {}; for (const p of ps) if (!['power', 'gnd'].includes(p.kind)) io[p.name] = gpiosOn(p.key);
    return { obj: o, powered, volts, io };
  });
  const netId = (key) => (parent.has(key) ? find(key) : null);
  return { board, parts, shorts: shorts.length > 0, netOf, gpiosOn, netId, nets };
}

/* ---------- starter layout: board left, parts in a row over a power rail ---------- */
const SIGNAL = {
  pir: [['OUT', 'pir']], sonar: [['TRIG', 'trig'], ['ECHO', 'echo']], soil: [['AOUT', 'soil']], ldr: [['AOUT', 'ldr']], ir: [['OUT', 'ir']], led: [['+', 'led']],
  servo: [['SIG', 'servo']], dht: [['DATA', 'dht']], relay: [['IN', 'relay']], rgb: [['R', 'rgbR'], ['G', 'rgbG'], ['B', 'rgbB']],
  seg7: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [n, `seg${n.toUpperCase()}`]),
};
let uid = 0;
export const newId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** Board, power rail and the given modules, each powered from the rail and wired to the board's default pins. */
export function defaultLayout(boardId, types = ['pir', 'sonar', 'ir', 'soil', 'ldr', 'led', 'oled']) {
  const b = BOARDS[boardId];
  const board = { id: 'board', kind: 'board', type: boardId, x: -b.w - 8, y: b.orient === 'v' ? -4 : -2 };
  const objects = [board], wires = [];
  const rail = { id: 'rail', kind: 'part', type: 'rail', x: 0, y: 14 };
  objects.push(rail);
  let x = 1;
  const keyAt = (o, name) => `${o.id}:${name}`;
  const boardPin = (pred) => b.pins.find(pred);
  // Board power into the rail.
  const vcc = boardPin((p) => p.name === b.vcc), bg = boardPin((p) => p.kind === 'gnd');
  wires.push({ id: newId('w'), a: keyAt(board, vcc.name), b: keyAt(rail, '+0') });
  wires.push({ id: newId('w'), a: keyAt(board, bg.name), b: keyAt(rail, '−0') });
  for (const type of types) {
    const P = PARTS[type], o = { id: type, kind: 'part', type, x, y: 14 - 3 - P.h };
    objects.push(o);
    for (const p of P.pins) {
      const hole = x + p.x - 1;
      if (p.kind === 'power') wires.push({ id: newId('w'), a: keyAt(o, p.name), b: keyAt(rail, `+${hole}`) });
      if (p.kind === 'gnd') wires.push({ id: newId('w'), a: keyAt(o, p.name), b: keyAt(rail, `−${hole}`) });
    }
    for (const [pn, role] of SIGNAL[type] || []) {
      const target = boardPin((q) => q.kind === 'gpio' && q.gpio === b.defaults[role]);
      if (target) wires.push({ id: newId('w'), a: keyAt(o, pn), b: keyAt(board, target.name) });
    }
    if (type === 'oled') {
      const sda = boardPin((q) => q.kind === 'gpio' && q.gpio === b.i2c.sda), scl = boardPin((q) => q.kind === 'gpio' && q.gpio === b.i2c.scl);
      wires.push({ id: newId('w'), a: keyAt(o, 'SDA'), b: keyAt(board, sda.name) });
      wires.push({ id: newId('w'), a: keyAt(o, 'SCL'), b: keyAt(board, scl.name) });
    }
    x += P.w + 2;
  }
  // A lamp next to a relay goes on its switched side: COM to one end, NO to the other.
  const relay = objects.find((o) => o.type === 'relay'), lamp = objects.find((o) => o.type === 'lamp');
  if (relay && lamp) { wires.push({ id: newId('w'), a: keyAt(relay, 'COM'), b: keyAt(lamp, 'L1') }); wires.push({ id: newId('w'), a: keyAt(relay, 'NO'), b: keyAt(lamp, 'L2') }); }
  return { board: boardId, objects, wires };
}

/** Pin names to drop into example sketches, read from the wiring on the bench. */
export function sketchPins(layout, nl) {
  const b = BOARDS[layout.board], out = {};
  const first = (type, pinName, role) => {
    // pinName null means "whichever lead reaches the board" (a button has two identical legs).
    const pick = (p) => (pinName ? p.io[pinName] : Object.values(p.io).find((gs) => gs.length)) || [];
    const part = nl.parts.find((p) => p.obj.type === type && pick(p).length);
    const g = part ? pick(part)[0] : b.defaults[role];
    return b.code(g);
  };
  out.PIR = first('pir', 'OUT', 'pir'); out.TRIG = first('sonar', 'TRIG', 'trig'); out.ECHO = first('sonar', 'ECHO', 'echo');
  out.SOIL = first('soil', 'AOUT', 'soil'); out.LDR = first('ldr', 'AOUT', 'ldr'); out.IR = first('ir', 'OUT', 'ir'); out.LED = first('led', '+', 'led');
  out.ADCMAX = String(b.adcMax); out.DRY = String(Math.round(b.adcMax * 0.806)); out.WET = String(Math.round(b.adcMax * 0.293));
  out.BUTTON = first('button', null, 'button'); out.POT = first('pot', 'W', 'pot'); out.LEDC = first('ledc', 'A', 'ledc');
  out.SERVO = first('servo', 'SIG', 'servo'); out.DHT = first('dht', 'DATA', 'dht'); out.RELAY = first('relay', 'IN', 'relay');
  out.RGB_R = first('rgb', 'R', 'rgbR'); out.RGB_G = first('rgb', 'G', 'rgbG'); out.RGB_B = first('rgb', 'B', 'rgbB');
  for (const n of 'abcdefg') out[`SEG_${n.toUpperCase()}`] = first('seg7', n, `seg${n.toUpperCase()}`);
  out.BOARD = b.name;
  return out;
}

/** Reference designators (R1, LED2, SW1…) in the order parts sit on the bench. */
const PREFIX = { resistor: 'R', ledc: 'LED', diode: 'D', cap: 'C', npn: 'Q', button: 'SW', toggle: 'S', pot: 'RV', buzzer: 'BZ' };
export function partLabels(layout) {
  const count = {}, out = new Map();
  for (const o of layout.objects) {
    if (o.kind !== 'part' || o.type === 'rail') continue;
    const pre = PREFIX[o.type];
    if (!pre) { out.set(o.id, PARTS[o.type].name); continue; }
    count[pre] = (count[pre] || 0) + 1; out.set(o.id, `${pre}${count[pre]}`);
  }
  return out;
}
export const fmtR = (R) => (R >= 1e6 ? `${+(R / 1e6).toPrecision(3)} MΩ` : R >= 1e3 ? `${+(R / 1e3).toPrecision(3)} kΩ` : `${R} Ω`);

/** Adds a push button, a potentiometer and a resistor + LED below the rail, wired to the board's default pins. */
export function componentDemo(layout) {
  const b = BOARDS[layout.board], board = layout.objects.find((o) => o.kind === 'board'), rail = layout.objects.find((o) => o.type === 'rail');
  const has = (t) => layout.objects.some((o) => o.type === t);
  if (!rail || (has('button') && has('pot') && has('ledc'))) return layout;
  const objects = [...layout.objects], wires = [...layout.wires];
  const bp = (g) => b.pins.find((q) => q.kind === 'gpio' && q.gpio === g)?.name;
  const hole = (sign, x) => `${rail.id}:${sign}${Math.max(0, Math.min(51, x - rail.x - 1))}`;
  const w = (a, c) => wires.push({ id: newId('w'), a, b: c });
  const y = rail.y + 5;
  const btn = { id: newId('button'), kind: 'part', type: 'button', x: 2, y, rot: 0 };
  const pot = { id: newId('pot'), kind: 'part', type: 'pot', x: 8, y, rot: 0 };
  const res = { id: newId('resistor'), kind: 'part', type: 'resistor', x: 15, y: y + 1, rot: 0, props: { R: 220 } };
  const led = { id: newId('ledc'), kind: 'part', type: 'ledc', x: 21, y: y + 1, rot: 0, props: { color: 'green' } };
  objects.push(btn, pot, res, led);
  w(`${btn.id}:1`, `${board.id}:${bp(b.defaults.button)}`); w(`${btn.id}:2`, hole('−', btn.x + 2));
  w(`${pot.id}:1`, hole('+', pot.x + 1)); w(`${pot.id}:3`, hole('−', pot.x + 3)); w(`${pot.id}:W`, `${board.id}:${bp(b.defaults.pot)}`);
  w(`${res.id}:1`, `${board.id}:${bp(b.defaults.ledc)}`); w(`${res.id}:2`, `${led.id}:A`); w(`${led.id}:K`, hole('−', led.x + 3));
  return { ...layout, objects, wires };
}
