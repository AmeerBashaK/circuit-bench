// Missions: each level places locked parts, limits the toolbox, and lists goals the live simulation must hold.
// Goals are checked against the running circuit; all of them must stay true for `hold` simulated seconds.
import { fA } from './engine.js';

const P = (x, y) => ({ x, y });
const LOCK = true;
const alive = (b, type) => b.els.filter((e) => e.type === type && !e.failed);
const leds = (b) => alive(b, 'led');
const lit = (e, min = 0.003) => e.I > min;
const partCount = (b) => b.els.filter((e) => e.type !== 'wire' && !e.locked).length;
const maxStress = (b) => Math.max(0, ...b.els.filter((e) => !e.failed && e.type !== 'dc' && e.type !== 'ac').map((e) => e.stress || 0));
const inWindow = (e, lo, hi) => e.I >= lo && e.I <= hi;
const mA = (x) => x / 1000;

// A battery on the left and a dark LED on the right, joined by nothing: the player builds the rest.
function sourceAndLed(add, V, color, ledLocked = LOCK, extra) {
  add('dc', P(-10, -4), P(-10, 4), { V }, LOCK);
  if (color) add('led', P(8, -4), P(8, 4), { color, Imax: 0.03 }, ledLocked);
  extra?.(add);
}

const HAND = [
  {
    title: 'First light',
    brief: 'The red LED is dark. Wire it to the 9 V battery so it glows, without letting it burn out.',
    hint: 'Without a resistor the LED takes far too much current. Add one in series.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'red'),
    goals: [
      { text: 'LED1 lit above 5 mA', test: (b) => leds(b).some((e) => lit(e, mA(5))) },
      { text: 'No part above its rating', test: (b) => maxStress(b) <= 1 },
    ],
  },
  {
    title: 'Dial it in',
    brief: 'Run the green LED at 12 to 18 mA from 9 V. Too little and it is dim, too much and it cooks.',
    hint: 'Current ≈ (supply − LED voltage) ÷ R. A green LED drops about 2.2 V.',
    allowed: ['wire', 'resistor'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, 'green'),
    goals: [{ text: 'LED1 between 12 and 18 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(12), mA(18))) }],
  },
  {
    title: 'Two in a row',
    brief: 'Light two LEDs in series from one resistor. The same current must pass through both.',
    hint: 'Series means one path: battery, resistor, LED, LED, back to the battery.',
    allowed: ['wire', 'resistor', 'led'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'Two LEDs lit above 5 mA', test: (b) => leds(b).filter((e) => lit(e, mA(5))).length >= 2 },
      { text: 'They share the same current', test: (b) => { const l = leds(b).filter((e) => lit(e, mA(5))).sort((a, c) => c.I - a.I); return l.length >= 2 && Math.abs(l[0].I - l[1].I) / l[0].I < 0.05; } },
      { text: 'No part above its rating', test: (b) => maxStress(b) <= 1 },
    ],
  },
  {
    title: 'Side by side',
    brief: 'From a 5 V supply, light three LEDs at the same time, each between 8 and 20 mA.',
    hint: 'Give each LED its own resistor and put the branches in parallel.',
    allowed: ['wire', 'resistor', 'led'], hold: 3,
    setup: (add) => sourceAndLed(add, 5, null),
    goals: [
      { text: 'Three LEDs between 8 and 20 mA', test: (b) => leds(b).filter((e) => inWindow(e, mA(8), mA(20))).length >= 3 },
      { text: 'No part above its rating', test: (b) => maxStress(b) <= 1 },
    ],
  },
  {
    title: 'Power budget',
    brief: 'A 24 V rail and a blue LED at 15 to 25 mA. You only have 0.25 W resistors, and one alone will overheat.',
    hint: 'Split the voltage across several resistors so each one burns less power.',
    allowed: ['wire', 'resistor'], hold: 4,
    setup: (add) => sourceAndLed(add, 24, 'blue'),
    goals: [
      { text: 'LED1 between 15 and 25 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(15), mA(25))) },
      { text: 'Every resistor rated 0.25 W or less', test: (b) => b.els.filter((e) => e.type === 'resistor').every((e) => e.props.P <= 0.25) },
      { text: 'No part above 90% of its rating', test: (b) => maxStress(b) <= 0.9 },
    ],
  },
  {
    title: 'Afterglow',
    brief: 'Keep an LED lit for 2 seconds after the switch is opened and the battery is cut off.',
    hint: 'A big capacitor can store charge while the switch is closed, then feed the LED.',
    allowed: ['wire', 'resistor', 'capacitor', 'led'], hold: 2,
    setup: (add) => { add('dc', P(-10, -4), P(-10, 4), { V: 9 }, LOCK); add('switch', P(-10, -4), P(-4, -4), { closed: true }, LOCK); },
    goals: [
      { text: 'Switch S1 is open', test: (b) => b.els.some((e) => e.type === 'switch' && !e.props.closed) },
      { text: 'An LED is still lit above 2 mA', test: (b) => leds(b).some((e) => lit(e, mA(2))) },
    ],
  },
  {
    title: 'Small current, big light',
    brief: 'Use a transistor so a tiny base current switches an LED on at more than 10 mA.',
    hint: 'LED and resistor on the collector, a large resistor (around 10 kΩ) into the base.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'An LED lit above 10 mA', test: (b) => leds(b).some((e) => lit(e, mA(10))) },
      { text: 'Transistor collector above 10 mA', test: (b) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > mA(10)) },
      { text: 'Base current under 0.5 mA', test: (b) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > mA(10) && Math.abs(e.Ib || 0) < mA(0.5)) },
    ],
  },
  {
    title: 'Tame the AC',
    brief: 'The source swings ±10 V twice a second. Keep the LED lit without a single flicker for 3 seconds.',
    hint: 'A diode stops the reverse swing; a capacitor fills the gaps between peaks.',
    allowed: ['wire', 'resistor', 'diode', 'capacitor', 'led'], hold: 3,
    setup: (add) => { add('ac', P(-10, -4), P(-10, 4), { V: 10, f: 2 }, LOCK); add('led', P(8, -4), P(8, 4), { color: 'yellow', Imax: 0.03 }, LOCK); },
    goals: [
      { text: 'LED1 never drops below 2 mA', test: (b) => leds(b).some((e) => lit(e, mA(2))) },
      { text: 'No part above its rating', test: (b) => maxStress(b) <= 1 },
    ],
  },
  {
    title: 'Rainbow rail',
    brief: 'From 12 V, light a red, a green and a blue LED, each between 5 and 20 mA, using 8 parts or fewer.',
    hint: 'Each colour drops a different voltage, so each needs its own resistor value.',
    allowed: ['wire', 'resistor', 'led'], hold: 3, maxParts: 8,
    setup: (add) => sourceAndLed(add, 12, null),
    goals: [
      ...['red', 'green', 'blue'].map((c) => ({ text: `${c[0].toUpperCase() + c.slice(1)} LED between 5 and 20 mA`, test: (b) => leds(b).some((e) => e.props.color === c && inWindow(e, mA(5), mA(20))) })),
      { text: '8 parts or fewer (wires free)', test: (b) => partCount(b) <= 8 },
    ],
  },
  {
    title: 'The gauntlet',
    brief: 'Four LEDs from 24 V, every part under 70% of its rating, 8 parts or fewer.',
    hint: 'A long series string drops most of the voltage in the LEDs and spares the resistor.',
    allowed: ['wire', 'resistor', 'led', 'diode'], hold: 4, maxParts: 8,
    setup: (add) => sourceAndLed(add, 24, null),
    goals: [
      { text: 'Four LEDs lit above 5 mA', test: (b) => leds(b).filter((e) => lit(e, mA(5))).length >= 4 },
      { text: 'Every part under 70% of its rating', test: (b) => maxStress(b) <= 0.7 },
      { text: '8 parts or fewer (wires free)', test: (b) => partCount(b) <= 8 },
    ],
  },
];

const COLORS = ['red', 'yellow', 'green', 'blue', 'white'];

// Endless levels: odd supplies, tighter current windows and lower stress ceilings as the level climbs.
function generated(level) {
  const k = level - HAND.length, V = 6 + ((k * 7) % 19), color = COLORS[k % COLORS.length];
  const width = Math.max(1, 8 - k * 0.6), mid = 10 + ((k * 5) % 9), lo = mid - width / 2, hi = mid + width / 2;
  const ceiling = Math.max(0.5, 0.9 - k * 0.03), count = 1 + Math.floor(k / 4);
  const plural = count > 1;
  return {
    title: `Calibration ${String(k).padStart(2, '0')}`,
    brief: `${V} V supply. ${plural ? `${count} ${color} LEDs` : `One ${color} LED`} between ${lo.toFixed(1)} and ${hi.toFixed(1)} mA, every part under ${Math.round(ceiling * 100)}% of its rating.`,
    hint: 'Work out the resistor on paper, then fine-tune in the inspector. Combine resistors for odd values.',
    allowed: ['wire', 'resistor', 'led'], hold: 3 + Math.min(3, k * 0.25),
    setup: (add) => sourceAndLed(add, V, null),
    goals: [
      { text: `${count} ${color} LED${plural ? 's' : ''} in ${lo.toFixed(1)}–${hi.toFixed(1)} mA`, test: (b) => leds(b).filter((e) => e.props.color === color && inWindow(e, mA(lo), mA(hi))).length >= count },
      { text: `Every part under ${Math.round(ceiling * 100)}% of its rating`, test: (b) => maxStress(b) <= ceiling },
    ],
  };
}

export function mission(level) {
  const m = level <= HAND.length ? HAND[level - 1] : generated(level);
  return { level, ...m };
}
export const HAND_LEVELS = HAND.length;
export const describeCurrent = fA;
