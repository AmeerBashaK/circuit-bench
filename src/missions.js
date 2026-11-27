// Missions: 50 hand-made levels in six chapters, each adding one idea, then endless generated levels.
// Most levels list goals the live simulation must hold for `hold` simulated seconds.
// Logic levels (and the two switch levels) are checked with a truth test instead: every input combination in turn.
// Every hand-made level carries a hidden `solution` (and sometimes an `act`) that the Node test builds to prove it can be won.
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
const across = (b, name) => { const e = b.byName(name); return e ? b.voltageAt(name, 0) - b.voltageAt(name, 1) : NaN; };
const onlyKilo = (b) => { const r = b.els.filter((e) => e.type === 'resistor' && !e.locked); return r.length > 0 && r.every((e) => Math.abs(e.props.R - 1000) < 1); };
const noOverload = { text: 'No part above its rating', test: (b) => maxStress(b) <= 1 };

// A battery on the left (+ at the top) and an optional dark LED on the right, joined by nothing.
function sourceAndLed(add, V, color, ledLocked = LOCK, extra) {
  add('dc', P(-10, -4), P(-10, 4), { V }, LOCK);
  if (color) add('led', P(8, -4), P(8, 4), { color, Imax: 0.03 }, ledLocked);
  extra?.(add);
}
// A battery, a ground wire along the bottom and a named load (a resistor used as a meter) on the right.
function sourceAndMeter(add, src, R, name = 'OUT') {
  if (src.ac) add('ac', P(-10, -4), P(-10, 4), { V: src.V, f: src.f }, LOCK); else add('dc', P(-10, -4), P(-10, 4), { V: src.V }, LOCK);
  add('resistor', P(8, -4), P(8, 4), { R, P: 0.25 }, LOCK, name);
  add('wire', P(8, 4), P(-10, 4), {}, LOCK);
}

// Hidden reference-solution helpers.
const k10 = { R: 10000, P: 0.25 }, k1 = { R: 1000, P: 0.25 };
const R = (add, a, b, ohms, P_ = 0.25) => add('resistor', a, b, { R: ohms, P: P_ });
const npn = (add, base) => add('bjt', base, 0); // collector at base +(2,−2), emitter at base +(2,+2)
function wire(add, a, b) { add('wire', a, b, {}); }
const led = (add, a, b, color = 'red') => add('led', a, b, { color, Imax: 0.03 });
const home = (add, from) => wire(add, from, P(-10, 4)); // back to the battery's minus

const BASICS = [
  {
    title: 'Close the loop',
    brief: 'The resistor and LED are already here. Join them to the battery with wires so current can go round.',
    hint: 'Current needs a full loop: battery +, resistor, LED, and back to battery −. Drag from one dot to another to draw a wire.',
    allowed: ['wire'], hold: 1.5,
    setup: (add) => { sourceAndLed(add, 9, 'red'); add('resistor', P(-4, -4), P(4, -4), { R: 470, P: 0.25 }, LOCK); },
    goals: [{ text: 'LED1 lit above 3 mA', test: (b) => leds(b).some((e) => lit(e)) }],
    solution: (add) => { wire(add, P(-10, -4), P(-4, -4)); wire(add, P(4, -4), P(8, -4)); home(add, P(8, 4)); },
  },
  {
    title: 'First light',
    brief: 'The red LED is dark. Wire it to the 9 V battery so it glows, without letting it burn out.',
    hint: 'Without a resistor the LED takes far too much current. Add one in series.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'red'),
    goals: [{ text: 'LED1 lit above 5 mA', test: (b) => leds(b).some((e) => lit(e, mA(5))) }, noOverload],
    solution: (add) => { R(add, P(-10, -4), P(8, -4), 470); home(add, P(8, 4)); },
  },
  {
    title: 'Flip the switch',
    brief: 'Put switch S1 in the loop so it controls the LED, then close it to switch the light on.',
    hint: 'A switch is a gap you can open and close. It goes in series, in the same loop as the LED. Select it and press Close.',
    allowed: ['wire', 'resistor'], hold: 1.5,
    setup: (add) => { sourceAndLed(add, 9, 'red'); add('switch', P(-6, -6), P(-2, -6), { closed: false }, LOCK, 'S1'); },
    goals: [
      { text: 'S1 is closed', test: (b) => !!b.byName('S1')?.props.closed },
      { text: 'Current flows through S1 and LED1 (above 5 mA)', test: (b) => Math.abs(b.byName('S1')?.I || 0) > mA(5) && leds(b).some((e) => lit(e, mA(5))) },
      noOverload,
    ],
    solution: (add) => { wire(add, P(-10, -4), P(-6, -6)); R(add, P(-2, -6), P(8, -4), 470); home(add, P(8, 4)); },
    act: async (b, step) => { b.setInput('S1', true); await step(0.2); },
  },
  {
    title: 'Push to light',
    brief: 'Wire push button PB1 so the LED is lit only while you hold it down. Hold it for one second.',
    hint: 'A push button is a switch that springs back open. Wire it like S1 last level, then click and hold it on the bench.',
    allowed: ['wire', 'resistor'], hold: 1,
    setup: (add) => { sourceAndLed(add, 9, 'green'); add('button', P(-6, -6), P(-2, -6), {}, LOCK, 'PB1'); },
    goals: [
      { text: 'PB1 held down', test: (b) => !!b.byName('PB1')?.props.pressed },
      { text: 'LED1 lit through PB1 (above 5 mA)', test: (b) => Math.abs(b.byName('PB1')?.I || 0) > mA(5) && leds(b).some((e) => lit(e, mA(5))) },
      noOverload,
    ],
    solution: (add) => { wire(add, P(-10, -4), P(-6, -6)); R(add, P(-2, -6), P(8, -4), 470); home(add, P(8, 4)); },
    act: async (b, step) => { b.press(b.byName('PB1'), true); await step(0.2); },
  },
  {
    title: 'Dial it in',
    brief: 'Run the green LED at 12 to 18 mA from 9 V. Too little and it is dim, too much and it cooks.',
    hint: 'Current ≈ (supply − LED voltage) ÷ R. A green LED drops about 2.2 V.',
    allowed: ['wire', 'resistor'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, 'green'),
    goals: [{ text: 'LED1 between 12 and 18 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(12), mA(18))) }],
    solution: (add) => { R(add, P(-10, -4), P(8, -4), 450); home(add, P(8, 4)); },
  },
  {
    title: 'Two in series',
    brief: 'Only 1 kΩ resistors on this level. Run the red LED at 3 to 4 mA from 9 V.',
    hint: 'One 1 kΩ gives about 7 mA. Resistors in a row add up: two of them make 2 kΩ.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'red'),
    goals: [
      { text: 'LED1 between 3 and 4 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(3), mA(4))) },
      { text: 'Every resistor you add is 1 kΩ', test: onlyKilo },
    ],
    solution: (add) => { R(add, P(-10, -4), P(-2, -4), 1000); R(add, P(-2, -4), P(8, -4), 1000); home(add, P(8, 4)); },
  },
];

const RESISTORS = [
  {
    title: 'Side by side',
    brief: 'Still only 1 kΩ resistors. This time run the red LED at 12 to 16 mA from 9 V.',
    hint: 'Two resistors side by side give current two paths, so together they act like 500 Ω.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'red'),
    goals: [
      { text: 'LED1 between 12 and 16 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(12), mA(16))) },
      { text: 'Every resistor you add is 1 kΩ', test: onlyKilo },
    ],
    solution: (add) => { R(add, P(-10, -4), P(8, -4), 1000); wire(add, P(-10, -4), P(-10, -8)); R(add, P(-10, -8), P(8, -8), 1000); wire(add, P(8, -8), P(8, -4)); home(add, P(8, 4)); },
  },
  {
    title: 'Halfway there',
    brief: 'Make OUT read between 4.2 and 4.8 V from the 9 V battery. That is about half.',
    hint: 'A voltage divider: two equal resistors in a row from + to −. The point between them sits halfway. Connect OUT there.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndMeter(add, { V: 9 }, 100000),
    goals: [{ text: 'OUT between 4.2 and 4.8 V', test: (b) => { const v = across(b, 'OUT'); return v >= 4.2 && v <= 4.8; } }],
    solution: (add) => { R(add, P(-10, -4), P(2, -4), 1000); R(add, P(2, -4), P(2, 4), 1000); wire(add, P(2, -4), P(8, -4)); },
  },
  {
    title: 'Power for a chip',
    brief: 'Many sensors run on 3.3 V. Make OUT read 3.1 to 3.5 V from the 9 V battery.',
    hint: 'In a divider, the bottom resistor gets its share of the 9 V. For 3.3 V the top one must be about 1.7 times the bottom one.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndMeter(add, { V: 9 }, 100000),
    goals: [{ text: 'OUT between 3.1 and 3.5 V', test: (b) => { const v = across(b, 'OUT'); return v >= 3.1 && v <= 3.5; } }],
    solution: (add) => { R(add, P(-10, -4), P(2, -4), 1700); R(add, P(2, -4), P(2, 4), 1000); wire(add, P(2, -4), P(8, -4)); },
  },
  {
    title: 'Bright and dim',
    brief: 'Light both LEDs from 9 V: one bright at 15 to 20 mA, the other dim at 1 to 3 mA.',
    hint: 'Each LED gets its own resistor. A bigger resistor means less current and a dimmer light.',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => { sourceAndLed(add, 9, 'red'); add('led', P(12, -4), P(12, 4), { color: 'red', Imax: 0.03 }, LOCK); },
    goals: [
      { text: 'One LED between 15 and 20 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(15), mA(20))) },
      { text: 'One LED between 1 and 3 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(1), mA(3))) },
    ],
    solution: (add) => { R(add, P(-10, -4), P(8, -4), 400); wire(add, P(-10, -4), P(-10, -8)); R(add, P(-10, -8), P(12, -4), 3300); wire(add, P(12, 4), P(8, 4)); home(add, P(8, 4)); },
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
    solution: (add) => { R(add, P(-10, -4), P(-4, -4), 350); R(add, P(-4, -4), P(2, -4), 350); R(add, P(2, -4), P(8, -4), 350); home(add, P(8, 4)); },
  },
  {
    title: 'Odd value',
    brief: 'Only 1 kΩ resistors again. Run the red LED at 4.5 to 5 mA from 9 V. You need 1.5 kΩ.',
    hint: 'Mix both tricks: one 1 kΩ in a row with a pair of 1 kΩ side by side (500 Ω).',
    allowed: ['wire', 'resistor'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'red'),
    goals: [
      { text: 'LED1 between 4.5 and 5 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(4.5), mA(5))) },
      { text: 'Every resistor you add is 1 kΩ', test: onlyKilo },
    ],
    solution: (add) => { R(add, P(-10, -4), P(0, -4), 1000); R(add, P(0, -4), P(8, -4), 1000); wire(add, P(0, -4), P(0, -8)); R(add, P(0, -8), P(8, -8), 1000); wire(add, P(8, -8), P(8, -4)); home(add, P(8, 4)); },
  },
];

// Three LEDs, each with its own resistor, side by side (used by two solutions).
function threeBranches(add, specs) {
  const xs = [0, 4, 8], tops = [-4, -6, -8];
  specs.forEach(([ohms, color], i) => { R(add, P(-10, -4), P(xs[i], tops[i]), ohms); led(add, P(xs[i], tops[i]), P(xs[i], 4), color); });
  wire(add, P(8, 4), P(4, 4)); wire(add, P(4, 4), P(0, 4)); home(add, P(0, 4));
}
// Two loose switches, a 5 V supply with rails, and output Y: the player wires the switches themselves.
function switchBench(add) {
  add('dc', P(-14, -6), P(-14, 6), { V: 5 }, LOCK);
  add('wire', P(-14, -6), P(16, -6), {}, LOCK);
  add('wire', P(-14, 6), P(16, 6), {}, LOCK);
  add('switch', P(-2, -2), P(2, -2), { closed: false }, LOCK, 'A');
  add('switch', P(-2, 2), P(2, 2), { closed: false }, LOCK, 'B');
  add('resistor', P(12, -2), P(12, 6), { R: 1000, P: 0.25 }, LOCK, 'Y');
}

const LEDS = [
  {
    title: 'Two in a row',
    brief: 'Light two LEDs in series from one resistor. The same current must pass through both.',
    hint: 'Series means one path: battery, resistor, LED, LED, back to the battery.',
    allowed: ['wire', 'resistor', 'led'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'Two LEDs lit above 5 mA', test: (b) => leds(b).filter((e) => lit(e, mA(5))).length >= 2 },
      { text: 'They share the same current', test: (b) => { const l = leds(b).filter((e) => lit(e, mA(5))).sort((a, c) => c.I - a.I); return l.length >= 2 && Math.abs(l[0].I - l[1].I) / l[0].I < 0.05; } },
      noOverload,
    ],
    solution: (add) => { R(add, P(-10, -4), P(0, -4), 300); led(add, P(0, -4), P(8, -4)); led(add, P(8, -4), P(8, 4)); home(add, P(8, 4)); },
  },
  {
    title: 'Three at once',
    brief: 'From a 5 V supply, light three LEDs at the same time, each between 8 and 20 mA.',
    hint: 'Give each LED its own resistor and put the branches side by side.',
    allowed: ['wire', 'resistor', 'led'], hold: 3,
    setup: (add) => sourceAndLed(add, 5, null),
    goals: [{ text: 'Three LEDs between 8 and 20 mA', test: (b) => leds(b).filter((e) => inWindow(e, mA(8), mA(20))).length >= 3 }, noOverload],
    solution: (add) => threeBranches(add, [[220, 'red'], [220, 'red'], [220, 'red']]),
  },
  {
    title: 'Rainbow rail',
    brief: 'From 12 V, light a red, a green and a blue LED, each between 5 and 20 mA, using 8 parts or fewer.',
    hint: 'Each colour drops a different voltage, so each needs its own resistor value.',
    allowed: ['wire', 'resistor', 'led'], hold: 3,
    setup: (add) => sourceAndLed(add, 12, null),
    goals: [
      ...['red', 'green', 'blue'].map((c) => ({ text: `${c[0].toUpperCase() + c.slice(1)} LED between 5 and 20 mA`, test: (b) => leds(b).some((e) => e.props.color === c && inWindow(e, mA(5), mA(20))) })),
      { text: '8 parts or fewer (wires free)', test: (b) => partCount(b) <= 8 },
    ],
    solution: (add) => threeBranches(add, [[840, 'red'], [820, 'green'], [740, 'blue']]),
  },
  {
    title: 'Both switches',
    brief: 'Wire switches A and B so output Y gets 5 V only when A and B are both closed. Then press Test.',
    hint: 'Put the two switches one after the other, in a row, between the top rail and Y. Current needs both gaps closed.',
    allowed: ['wire'], hold: 0, goals: [],
    logic: { inputs: ['A', 'B'], outputs: ['Y'], truth: ([a, b]) => [a && b], need: {}, direct: true },
    setup: switchBench,
    solution: (add) => { wire(add, P(-2, -6), P(-2, -2)); wire(add, P(2, -2), P(-2, 2)); wire(add, P(2, 2), P(12, -2)); },
  },
  {
    title: 'Either switch',
    brief: 'Now rewire them so Y gets 5 V when A or B is closed, or both. Then press Test.',
    hint: 'Put the switches side by side: each one joins the top rail to Y on its own.',
    allowed: ['wire'], hold: 0, goals: [],
    logic: { inputs: ['A', 'B'], outputs: ['Y'], truth: ([a, b]) => [a || b], need: {}, direct: true },
    setup: switchBench,
    solution: (add) => { wire(add, P(-2, -6), P(-2, -2)); wire(add, P(-2, -2), P(-4, 2)); wire(add, P(-4, 2), P(-2, 2)); wire(add, P(2, -2), P(12, -2)); wire(add, P(2, 2), P(6, 0)); wire(add, P(6, 0), P(12, -2)); },
  },
  {
    title: 'The gauntlet',
    brief: 'Four LEDs from 24 V, every part under 70% of its rating, 8 parts or fewer.',
    hint: 'A long series string drops most of the voltage in the LEDs and spares the resistors.',
    allowed: ['wire', 'resistor', 'led', 'diode'], hold: 4,
    setup: (add) => sourceAndLed(add, 24, null),
    goals: [
      { text: 'Four LEDs lit above 5 mA', test: (b) => leds(b).filter((e) => lit(e, mA(5))).length >= 4 },
      { text: 'Every part under 70% of its rating', test: (b) => maxStress(b) <= 0.7 },
      { text: '8 parts or fewer (wires free)', test: (b) => partCount(b) <= 8 },
    ],
    solution: (add) => { R(add, P(-10, -4), P(-4, -4), 820); R(add, P(-4, -4), P(0, -4), 820); led(add, P(0, -4), P(4, -4)); led(add, P(4, -4), P(8, -4)); led(add, P(8, -4), P(8, 0)); led(add, P(8, 0), P(8, 4)); home(add, P(8, 4)); },
  },
];

const DIODES = [
  {
    title: 'One way only',
    brief: 'A diode lets current through in one direction only. Put one in the loop so the LED still lights.',
    hint: 'The diode\'s bar end is where current comes out. Point it the same way current flows: from + towards the LED.',
    allowed: ['wire', 'resistor', 'diode'], hold: 2,
    setup: (add) => sourceAndLed(add, 9, 'yellow'),
    goals: [
      { text: 'A diode carries above 5 mA', test: (b) => alive(b, 'diode').some((e) => e.I > mA(5)) },
      { text: 'LED1 lit above 5 mA', test: (b) => leds(b).some((e) => lit(e, mA(5))) },
      noOverload,
    ],
    solution: (add) => { add('diode', P(-10, -4), P(-4, -4), {}); R(add, P(-4, -4), P(8, -4), 390); home(add, P(8, 4)); },
  },
  {
    title: 'Drop with diodes',
    brief: 'Each diode in a row eats about 0.7 V. Using only diodes, bring OUT down to 2.6 to 3.4 V from 5 V.',
    hint: 'Count it out: 5 V minus 0.7 V per diode. Three in a row lands near 3 V.',
    allowed: ['wire', 'diode'], hold: 2,
    setup: (add) => sourceAndMeter(add, { V: 5 }, 1000),
    goals: [{ text: 'OUT between 2.6 and 3.4 V', test: (b) => { const v = across(b, 'OUT'); return v >= 2.6 && v <= 3.4; } }],
    solution: (add) => { add('diode', P(-10, -4), P(-6, -4), {}); add('diode', P(-6, -4), P(-2, -4), {}); add('diode', P(-2, -4), P(8, -4), {}); },
  },
  {
    title: 'Charge up',
    brief: 'A capacitor stores charge like a tiny battery. Charge C1 above 8 V through a resistor.',
    hint: 'Join + to C1 through a resistor. Watch its voltage climb fast at first, then slower.',
    allowed: ['wire', 'resistor'], hold: 1,
    setup: (add) => { add('dc', P(-10, -4), P(-10, 4), { V: 9 }, LOCK); add('capacitor', P(8, -4), P(8, 4), { C: 1000, Vmax: 16, polar: true }, LOCK, 'C1'); add('wire', P(8, 4), P(-10, 4), {}, LOCK); },
    goals: [{ text: 'C1 charged above 8 V', test: (b) => (b.byName('C1')?.vc || 0) > 8 }, noOverload],
    solution: (add) => R(add, P(-10, -4), P(8, -4), 1000),
    act: async (b, step) => { await step(3); },
  },
  {
    title: 'Afterglow',
    brief: 'Keep an LED lit for 2 seconds after the switch is opened and the battery is cut off.',
    hint: 'A big capacitor can store charge while the switch is closed, then feed the LED.',
    allowed: ['wire', 'resistor', 'capacitor', 'led'], hold: 2,
    setup: (add) => { add('dc', P(-10, -4), P(-10, 4), { V: 9 }, LOCK); add('switch', P(-10, -4), P(-4, -4), { closed: true }, LOCK, 'S1'); },
    goals: [
      { text: 'Switch S1 is open', test: (b) => b.els.some((e) => e.type === 'switch' && !e.props.closed) },
      { text: 'An LED is still lit above 2 mA', test: (b) => leds(b).some((e) => lit(e, mA(2))) },
    ],
    solution: (add) => { add('capacitor', P(-4, -4), P(-4, 4), { C: 2200, Vmax: 16, polar: true }); R(add, P(-4, -4), P(8, -4), 1000); led(add, P(8, -4), P(8, 4)); wire(add, P(8, 4), P(-4, 4)); wire(add, P(-4, 4), P(-10, 4)); },
    act: async (b, step) => { await step(3); b.setInput('S1', false); await step(0.1); },
  },
  {
    title: 'Tame the AC',
    brief: 'The source swings ±10 V twice a second. Keep the LED lit without a single flicker for 3 seconds.',
    hint: 'A diode stops the reverse swing; a capacitor fills the gaps between peaks.',
    allowed: ['wire', 'resistor', 'diode', 'capacitor', 'led'], hold: 3,
    setup: (add) => { add('ac', P(-10, -4), P(-10, 4), { V: 10, f: 2 }, LOCK); add('led', P(8, -4), P(8, 4), { color: 'yellow', Imax: 0.03 }, LOCK); },
    goals: [{ text: 'LED1 never drops below 2 mA', test: (b) => leds(b).some((e) => lit(e, mA(2))) }, noOverload],
    solution: (add) => { add('diode', P(-10, -4), P(-4, -4), {}); add('capacitor', P(-4, -4), P(-4, 4), { C: 2200, Vmax: 16, polar: true }); R(add, P(-4, -4), P(8, -4), 470); home(add, P(8, 4)); },
    act: async (b, step) => { await step(1); },
  },
  {
    title: 'Make DC from AC',
    brief: 'Turn the ±12 V AC into steady DC: OUT must stay between 7 and 12 V for 3 seconds.',
    hint: 'Same trick as the last level, with no LED this time: a diode, then a big capacitor across OUT.',
    allowed: ['wire', 'resistor', 'diode', 'capacitor'], hold: 3,
    setup: (add) => sourceAndMeter(add, { ac: true, V: 12, f: 1 }, 1000),
    goals: [{ text: 'OUT stays between 7 and 12 V', test: (b) => { const v = across(b, 'OUT'); return v >= 7 && v <= 12; } }, noOverload],
    solution: (add) => { add('diode', P(-10, -4), P(-4, -4), {}); add('capacitor', P(-4, -4), P(-4, 4), { C: 4700, Vmax: 16, polar: true }); wire(add, P(-4, -4), P(8, -4)); },
    act: async (b, step) => { await step(2); },
  },
];

// The collector side for transistor levels: + → resistor → LED → collector at (2,−2); emitter (2,2) → minus.
function collectorLed(add, ohms, base) {
  R(add, P(-10, -4), P(2, -8), ohms); led(add, P(2, -8), P(2, -2)); npn(add, P(0, 0)); wire(add, P(2, 2), P(2, 4)); home(add, P(2, 4));
  if (base) R(add, P(-10, -4), P(0, 0), base);
}
const bjtOver = (b, i) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > i);

const TRANSISTORS = [
  {
    title: 'Small current, big light',
    brief: 'Use a transistor so a tiny base current switches an LED on at more than 10 mA.',
    hint: 'LED and resistor on the collector, a large resistor (around 20 kΩ) into the base.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'An LED lit above 10 mA', test: (b) => leds(b).some((e) => lit(e, mA(10))) },
      { text: 'Transistor collector above 10 mA', test: (b) => bjtOver(b, mA(10)) },
      { text: 'Base current under 0.5 mA', test: (b) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > mA(10) && Math.abs(e.Ib || 0) < mA(0.5)) },
    ],
    solution: (add) => collectorLed(add, 330, 22000),
  },
  {
    title: 'Gain',
    brief: 'No resistor on the collector this time. Let the base resistor alone set the LED to 10 to 15 mA.',
    hint: 'This transistor multiplies its base current by about 100. For 12 mA you need about 0.12 mA into the base: (9 − 0.7) ÷ 0.12 mA ≈ 68 kΩ.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'An LED between 10 and 15 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(10), mA(15))) },
      { text: 'No resistor carries more than 1 mA', test: (b) => b.els.filter((e) => e.type === 'resistor').every((e) => Math.abs(e.I) <= mA(1)) },
      noOverload,
    ],
    solution: (add) => { wire(add, P(-10, -4), P(-10, -8)); wire(add, P(-10, -8), P(2, -8)); led(add, P(2, -8), P(2, -2)); npn(add, P(0, 0)); wire(add, P(2, 2), P(2, 4)); home(add, P(2, 4)); R(add, P(-10, -4), P(0, 0), 68000); },
  },
  {
    title: 'Two lights, one switch',
    brief: 'One transistor drives two LEDs, each above 8 mA, with under 0.5 mA into its base.',
    hint: 'Give each LED its own resistor and join both to the collector. The transistor carries the total.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'Two LEDs above 8 mA', test: (b) => leds(b).filter((e) => lit(e, mA(8))).length >= 2 },
      { text: 'Collector above 20 mA, base under 0.5 mA', test: (b) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > mA(20) && Math.abs(e.Ib || 0) < mA(0.5)) },
      noOverload,
    ],
    solution: (add) => { collectorLed(add, 330, 18000); R(add, P(-10, -4), P(6, -8), 330); led(add, P(6, -8), P(2, -2)); },
  },
  {
    title: 'Super gain',
    brief: 'Light an LED above 15 mA while under 0.02 mA flows into the first base. One transistor cannot do it.',
    hint: 'Chain two: the first transistor\'s emitter feeds the second one\'s base, and their collectors join. Gains multiply.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 9, null),
    goals: [
      { text: 'An LED lit above 15 mA', test: (b) => leds(b).some((e) => lit(e, mA(15))) },
      { text: 'Smallest base current under 0.02 mA', test: (b) => { const ib = alive(b, 'bjt').map((e) => Math.abs(e.Ib || 0)).filter((i) => i > 1e-7); return ib.length > 0 && Math.min(...ib) < mA(0.02); } },
      noOverload,
    ],
    solution: (add) => {
      npn(add, P(0, 0)); npn(add, P(2, 2)); wire(add, P(2, -2), P(4, -2)); wire(add, P(4, -2), P(4, 0));
      R(add, P(-10, -4), P(4, -8), 330); led(add, P(4, -8), P(4, -2)); wire(add, P(4, 4), P(-10, 4)); R(add, P(-10, -4), P(0, 0), 470000);
    },
  },
  {
    title: 'Delay off',
    brief: 'Press and release PB1. The LED must stay lit, through a transistor, for 1.5 s after you let go.',
    hint: 'While PB1 is held, charge a capacitor. When you let go, the capacitor keeps feeding the base through a resistor.',
    allowed: ['wire', 'resistor', 'led', 'bjt', 'capacitor'], hold: 1.5,
    setup: (add) => { sourceAndLed(add, 9, null); add('button', P(-10, -4), P(-6, -4), {}, LOCK, 'PB1'); },
    goals: [
      { text: 'PB1 released', test: (b) => !b.byName('PB1')?.props.pressed },
      { text: 'LED lit above 5 mA through a transistor', test: (b) => leds(b).some((e) => lit(e, mA(5))) && bjtOver(b, mA(5)) },
    ],
    solution: (add) => {
      R(add, P(-6, -4), P(-6, 0), 100); add('capacitor', P(-6, 0), P(-6, 4), { C: 1000, Vmax: 16, polar: true }); R(add, P(-6, 0), P(0, 0), 10000);
      R(add, P(-10, -4), P(2, -8), 330); led(add, P(2, -8), P(2, -2)); npn(add, P(0, 0)); wire(add, P(2, 2), P(2, 4)); home(add, P(2, 4));
    },
    act: async (b, step) => { const pb = b.byName('PB1'); b.press(pb, true); await step(0.6); b.press(pb, false); await step(0.1); },
  },
  {
    title: 'Heavy load',
    brief: 'From 24 V, light four LEDs in a row through a transistor: above 10 mA, under 0.5 mA into the base, every part under 80%.',
    hint: 'The LED string and its resistors sit on the collector. Split the resistor in two so neither overheats.',
    allowed: ['wire', 'resistor', 'led', 'bjt'], hold: 3,
    setup: (add) => sourceAndLed(add, 24, null),
    goals: [
      { text: 'Four LEDs lit above 10 mA', test: (b) => leds(b).filter((e) => lit(e, mA(10))).length >= 4 },
      { text: 'Collector above 10 mA, base under 0.5 mA', test: (b) => alive(b, 'bjt').some((e) => Math.abs(e.Ic || 0) > mA(10) && Math.abs(e.Ib || 0) < mA(0.5)) },
      { text: 'Every part under 80% of its rating', test: (b) => maxStress(b) <= 0.8 },
    ],
    solution: (add) => {
      wire(add, P(-10, -4), P(-10, -10)); R(add, P(-10, -10), P(-4, -10), 470); R(add, P(-4, -10), P(0, -10), 470);
      led(add, P(0, -10), P(4, -10)); led(add, P(4, -10), P(8, -10)); led(add, P(8, -10), P(8, -6)); led(add, P(8, -6), P(2, -2));
      npn(add, P(0, 0)); wire(add, P(2, 2), P(2, 4)); home(add, P(2, 4)); R(add, P(-10, -4), P(0, 0), 82000);
    },
  },
];

// ---------- Logic chapter ----------
// Every logic level gives the same fixed bench: a 5 V supply, a power rail along the top (y = −6) and a
// ground rail along the bottom (y = 6), input switches with 1 kΩ pull-downs (their input point is the lower
// end of each switch, at y = −2), and one 100 kΩ output meter per output (top end at y = −2).
// The student wires the gate in between. A level passes when the truth test gets every row right.
const LOGIC_TOOLS = ['wire', 'resistor', 'diode', 'bjt', 'led'];
const INPUT_X = { A: -10, B: -6, C: -2, S: -2 };
const HIGH = 3.0, LOW = 1.5; // volts: a gate output must be clearly one or the other

function logicBench(add, inputs, outputs, width) {
  add('dc', P(-14, -6), P(-14, 6), { V: 5 }, LOCK);
  add('wire', P(-14, -6), P(width, -6), {}, LOCK); // power rail
  add('wire', P(-14, 6), P(width, 6), {}, LOCK);   // ground rail
  for (const n of inputs) {
    const x = INPUT_X[n];
    add('switch', P(x, -6), P(x, -2), { closed: false }, LOCK, n);
    add('resistor', P(x, -2), P(x, 6), { R: 1000, P: 0.25 }, LOCK, `R${n}`);
  }
  for (const [n, x] of outputs) add('resistor', P(x, -2), P(x, 6), { R: 100000, P: 0.25 }, LOCK, n);
}

const A_IN = P(-10, -2), B_IN = P(-6, -2), C_IN = P(-2, -2);
/** NOT: input point → 10 k → base at (bx, by); collector pulled up by 1 k; emitter to ground. Returns the output point. */
function notGate(add, input, bx, by) {
  add('resistor', input, P(bx, by), k10); npn(add, P(bx, by));
  add('resistor', P(bx + 2, -6), P(bx + 2, by - 2), k1); wire(add, P(bx + 2, by + 2), P(bx + 2, 6));
  return P(bx + 2, by - 2);
}
/** NAND: two transistors in series under one pull-up. Returns the output point. */
function nandGate(add, a, b, bx) {
  add('resistor', a, P(bx, 0), k10); npn(add, P(bx, 0));
  add('resistor', b, P(bx, 4), k10); npn(add, P(bx, 4)); // its emitter lands on the ground rail
  add('resistor', P(bx + 2, -6), P(bx + 2, -2), k1);
  return P(bx + 2, -2);
}
/** NOR: transistors side by side, 6 apart, sharing one pull-up. Returns the output point. */
function norGate(add, ins, bx) {
  ins.forEach((inp, i) => { const x = bx + 6 * i; add('resistor', inp, P(x, 0), k10); npn(add, P(x, 0)); wire(add, P(x + 2, 2), P(x + 2, 6)); if (i) wire(add, P(x - 4, -2), P(x + 2, -2)); });
  add('resistor', P(bx + 2, -6), P(bx + 2, -2), k1);
  return P(bx + 2 + 6 * (ins.length - 1), -2);
}
/** Three-input NAND: three transistors chained emitter to collector, side by side. Returns the output point. */
function nand3(add, ins, bx) {
  ins.forEach((inp, i) => { const x = bx + 4 * i; add('resistor', inp, P(x, 0), k10); npn(add, P(x, 0)); });
  for (const i of [0, 1]) { const x = bx + 4 * i + 2; wire(add, P(x, 2), P(x + 1, 2)); wire(add, P(x + 1, 2), P(x + 1, -2)); wire(add, P(x + 1, -2), P(x + 4, -2)); }
  wire(add, P(bx + 10, 2), P(bx + 10, 6));
  add('resistor', P(bx + 2, -6), P(bx + 2, -4), k1); wire(add, P(bx + 2, -4), P(bx + 2, -2));
  return P(bx + 2, -4);
}
/** Diode AND: a 10 k pull-up to (x, 0) and a diode from there to each input. Returns (x, 0). */
function diodeAnd(add, ins, x) {
  add('resistor', P(x, -6), P(x, 0), k10);
  for (const i of ins) add('diode', P(x, 0), i, {});
  return P(x, 0);
}
/** XOR built from NOR + NOT (= OR), NAND and a diode AND. Uses bx … bx+20. Returns the output point. */
function xorGate(add, a, b, bx) {
  const or = notGate(add, norGate(add, [a, b], bx), bx + 12, 0);
  const n = nandGate(add, a, b, bx + 16);
  return diodeAnd(add, [or, n], bx + 22);
}

const gate = (title, brief, hint, inputs, outputs, truth, need, solution, width = 16) => ({
  title, brief, hint, allowed: LOGIC_TOOLS, hold: 0, goals: [],
  logic: { inputs, outputs: outputs.map(([n]) => n), truth, need },
  setup: (add) => logicBench(add, inputs, outputs, width),
  solution,
});
const AB = ['A', 'B'], ABC = ['A', 'B', 'C'];

const LOGIC = [
  gate('Transistor switch',
    'Make output Y follow switch A, but drive it through a transistor: A on, Y high. A off, Y low.',
    'Put a 10 kΩ resistor from A into the base. Collector to the power rail, emitter to Y.',
    ['A'], [['Y', 12]], ([a]) => [a], { bjt: [1, 9] },
    (add) => { add('resistor', A_IN, P(2, 0), k10); npn(add, P(2, 0)); wire(add, P(4, -2), P(4, -6)); wire(add, P(4, 2), P(12, -2)); }),
  gate('NOT gate',
    'Build an inverter. Y is high when A is off and low when A is on.',
    'A pull-up resistor holds the collector high. When the transistor turns on, it pulls the collector to ground. Take Y from the collector.',
    ['A'], [['Y', 12]], ([a]) => [!a], { bjt: [1, 9] },
    (add) => { const y = notGate(add, A_IN, 2, 0); wire(add, y, P(12, -2)); }),
  gate('Double NOT',
    'Feed one NOT gate into another. Two flips bring you back: Y follows A again.',
    'Build your NOT gate, then a second one whose input is the first one\'s output.',
    ['A'], [['Y', 14]], ([a]) => [a], { bjt: [2, 9] },
    (add) => { const n = notGate(add, A_IN, 2, 0); const y = notGate(add, n, 8, 0); wire(add, y, P(14, -2)); }),
  gate('OR gate from diodes',
    'Y is high when A or B is on. Use diodes, no transistors.',
    'A diode from each input to Y, pointing towards Y. Then a resistor from Y to ground so Y falls low when both are off.',
    AB, [['Y', 12]], ([a, b]) => [a || b], { diode: [2, 9], bjt: [0, 0] },
    (add) => { add('diode', A_IN, P(2, 0), {}); add('diode', B_IN, P(2, 0), {}); add('resistor', P(2, 0), P(2, 6), k10); wire(add, P(2, 0), P(12, -2)); }),
  gate('AND gate from diodes',
    'Y is high only when A and B are both on. Use diodes, no transistors.',
    'A 10 kΩ pull-up holds Y high. A diode from Y to each input lets any input that is off drag Y down. The input pull-downs are 1 kΩ, so they win.',
    AB, [['Y', 12]], ([a, b]) => [a && b], { diode: [2, 9], bjt: [0, 0] },
    (add) => { const y = diodeAnd(add, [A_IN, B_IN], 2); wire(add, y, P(12, -2)); }),
  gate('Three-way OR',
    'A third switch, C. Y is high when any of the three is on. Diodes only.',
    'Same as your diode OR, with one more diode.',
    ABC, [['Y', 12]], ([a, b, c]) => [a || b || c], { diode: [3, 9], bjt: [0, 0] },
    (add) => { for (const i of [A_IN, B_IN, C_IN]) add('diode', i, P(2, 0), {}); add('resistor', P(2, 0), P(2, 6), k10); wire(add, P(2, 0), P(12, -2)); }),
  gate('Three-way AND',
    'Y is high only when A, B and C are all on. Diodes only.',
    'Same as your diode AND, with one more diode.',
    ABC, [['Y', 12]], ([a, b, c]) => [a && b && c], { diode: [3, 9], bjt: [0, 0] },
    (add) => { const y = diodeAnd(add, [A_IN, B_IN, C_IN], 2); wire(add, y, P(12, -2)); }),
  gate('NOR gate',
    'Y is high only when both inputs are off. Use transistors.',
    'Two NOT gates that share one pull-up: put the transistors side by side, so either one can pull Y down.',
    AB, [['Y', 12]], ([a, b]) => [!(a || b)], { bjt: [2, 9] },
    (add) => { const y = norGate(add, [A_IN, B_IN], 2); wire(add, y, P(12, -2)); }),
  gate('NAND gate',
    'Y is low only when both inputs are on. Use transistors.',
    'Stack two transistors, one on top of the other, under one pull-up. Y only falls when both are switched on.',
    AB, [['Y', 12]], ([a, b]) => [!(a && b)], { bjt: [2, 9] },
    (add) => { const y = nandGate(add, A_IN, B_IN, 2); wire(add, y, P(12, -2)); }),
  gate('Three-way NOR',
    'Y is high only when A, B and C are all off.',
    'Three transistors side by side under one pull-up. Any one of them can pull Y down.',
    ABC, [['Y', 20]], ([a, b, c]) => [!(a || b || c)], { bjt: [3, 12] },
    (add) => { const y = norGate(add, [A_IN, B_IN, C_IN], 2); wire(add, y, P(20, -2)); }, 22),
  gate('Three-way NAND',
    'Y is low only when A, B and C are all on.',
    'Chain three transistors so current must pass through all of them: each emitter feeds the next collector.',
    ABC, [['Y', 16]], ([a, b, c]) => [!(a && b && c)], { bjt: [3, 12] },
    (add) => { const y = nand3(add, [A_IN, B_IN, C_IN], 2); wire(add, y, P(16, -4)); wire(add, P(16, -4), P(16, -2)); }, 18),
  gate('AND gate from transistors',
    'Y is high only when A and B are both on. This time use transistors only, no diodes.',
    'You already have a NAND. Feed its output into a NOT gate.',
    AB, [['Y', 14]], ([a, b]) => [a && b], { bjt: [3, 9], diode: [0, 0] },
    (add) => { const n = nandGate(add, A_IN, B_IN, 2); const y = notGate(add, n, 8, 0); wire(add, y, P(14, -2)); }, 18),
  gate('OR gate from transistors',
    'Y is high when A or B is on. Transistors only, no diodes.',
    'A NOR followed by a NOT gives OR.',
    AB, [['Y', 20]], ([a, b]) => [a || b], { bjt: [3, 9], diode: [0, 0] },
    (add) => { const o = norGate(add, [A_IN, B_IN], 2); const y = notGate(add, o, 14, 0); wire(add, y, P(20, -2)); }, 22),
  gate('A but not B',
    'Y is high only when A is on and B is off. Think of B as a cancel button.',
    'Flip B with a NOT gate, then AND the result with A using diodes.',
    AB, [['Y', 12]], ([a, b]) => [a && !b], { bjt: [1, 9] },
    (add) => { const nb = notGate(add, B_IN, 2, 0); const y = diodeAnd(add, [A_IN, nb], 8); wire(add, y, P(12, -2)); }),
  gate('XOR gate',
    'Y is high when exactly one input is on, and low when both are off or both are on.',
    'XOR is "A or B" and "not both". Build an OR and a NAND, then join their outputs with a diode AND gate.',
    AB, [['Y', 28]], ([a, b]) => [a !== b], { bjt: [2, 12] },
    (add) => { const y = xorGate(add, A_IN, B_IN, 2); wire(add, y, P(28, -2)); }, 30),
  gate('Same or different',
    'Y is high when A and B match: both off or both on. This is XNOR, the opposite of XOR.',
    'Build your XOR, then put a NOT gate after it.',
    AB, [['Y', 32]], ([a, b]) => [a === b], { bjt: [3, 14] },
    (add) => { const x = xorGate(add, A_IN, B_IN, 2); const y = notGate(add, x, 26, 0); wire(add, y, P(32, -2)); }, 34),
  gate('Majority vote',
    'Three voters, A, B and C. Y is high when at least two of them are on.',
    'Check every pair: A and B, B and C, A and C, each with a diode AND. Then OR the three results with diodes.',
    ABC, [['Y', 14]], ([a, b, c]) => [a + b + c >= 2], {},
    (add) => {
      const ands = [diodeAnd(add, [A_IN, B_IN], 2), diodeAnd(add, [B_IN, C_IN], 4), diodeAnd(add, [A_IN, C_IN], 6)];
      for (const o of ands) add('diode', o, P(10, 0), {});
      wire(add, P(10, 0), P(14, -2));
    }, 16),
  gate('Half adder',
    'Add two one-bit numbers. S is the sum bit (XOR), C is the carry bit (AND). 1 + 1 = binary 10: S low, C high.',
    'Reuse your XOR for S. The carry is the NAND you already built, inverted by one more NOT gate.',
    AB, [['S', 28], ['C', 34]], ([a, b]) => [a !== b, a && b], { bjt: [3, 14] },
    (add) => {
      const o = norGate(add, [A_IN, B_IN], 2); const or = notGate(add, o, 14, 0);
      const n = nandGate(add, A_IN, B_IN, 18);
      diodeAnd(add, [or, n], 24); wire(add, P(24, 0), P(28, -2));
      const c = notGate(add, n, 30, 2); wire(add, c, P(34, -2));
    }, 36),
  gate('Selector',
    'S picks which input reaches Y. S off: Y copies A. S on: Y copies B.',
    'Two diode ANDs: "A and not S", "B and S". Then OR them with diodes. You need one NOT gate for "not S".',
    ['A', 'B', 'S'], [['Y', 18]], ([a, b, s]) => [s ? b : a], {},
    (add) => {
      const ns = notGate(add, C_IN, 2, 0);
      const a1 = diodeAnd(add, [A_IN, ns], 8), a2 = diodeAnd(add, [B_IN, C_IN], 10);
      add('diode', a1, P(14, 0), {}); add('diode', a2, P(14, 0), {}); wire(add, P(14, 0), P(18, -2));
    }, 20),
  gate('Full adder',
    'The real thing: add A + B + carry-in C. S is the sum bit, K is the carry out. 1 + 1 + 1 = binary 11.',
    'S is XOR of all three: an XOR of A and B, then an XOR of that with C. K is your majority vote.',
    ABC, [['S', 62], ['K', 66]], ([a, b, c]) => [(a + b + c) % 2 === 1, a + b + c >= 2], {},
    (add) => {
      const x1 = xorGate(add, A_IN, B_IN, 2); const x2 = xorGate(add, x1, C_IN, 26);
      wire(add, x2, P(62, -2));
      const ands = [diodeAnd(add, [A_IN, B_IN], 50), diodeAnd(add, [B_IN, C_IN], 52), diodeAnd(add, [A_IN, C_IN], 54)];
      for (const o of ands) add('diode', o, P(58, 0), {});
      wire(add, P(58, 0), P(66, -2));
    }, 68),
];

// Chapters, in order. The Missions panel shows where a level sits inside its chapter.
const CHAPTERS = [['Basics', BASICS], ['Resistors', RESISTORS], ['LEDs', LEDS], ['Diodes & caps', DIODES], ['Transistors', TRANSISTORS], ['Logic', LOGIC]];
const HAND = [];
for (const [name, list] of CHAPTERS) list.forEach((m, i) => HAND.push({ ...m, chapter: { name, index: i + 1, count: list.length } }));

/** Every input combination, A first: [[0,0],[0,1],[1,0],[1,1]] for two inputs. */
export const combos = (n) => Array.from({ length: 2 ** n }, (_, i) => Array.from({ length: n }, (_, j) => !!((i >> (n - 1 - j)) & 1)));

/** Part-count rules and wiring rules for a truth-tested level. Returns a list of problems (empty when fine). */
export function logicRules(bench, m) {
  const problems = [], count = (t) => bench.els.filter((e) => e.type === t && !e.locked).length;
  for (const [type, [min, max]] of Object.entries(m.logic.need || {})) {
    const n = count(type), label = type === 'bjt' ? 'transistor' : type;
    if (n < min) problems.push(`Use at least ${min} ${label}${min > 1 ? 's' : ''}.`);
    if (n > max) problems.push(max === 0 ? `No ${label}s on this level.` : `Use at most ${max} ${label}s.`);
  }
  if (!m.logic.direct) for (const out of m.logic.outputs) for (const inp of m.logic.inputs) {
    if (bench.wiredTogether(out, 0, inp, 1)) problems.push(`${out} is wired straight to ${inp}. Build a gate between them.`);
  }
  return problems;
}

/**
 * Run the truth table: set each input combination, let the circuit settle, read every output.
 * settle() waits for the simulation to move on; it is a real-time wait in the app and a frame-stepper in tests.
 */
export async function truthTest(bench, m, settle, onRow) {
  const rows = [];
  for (const combo of combos(m.logic.inputs.length)) {
    m.logic.inputs.forEach((n, i) => bench.setInput(n, combo[i]));
    await settle();
    const want = m.logic.truth(combo);
    const got = m.logic.outputs.map((n) => bench.voltageAt(n, 0));
    const ok = got.every((v, i) => (want[i] ? v >= HIGH : v <= LOW));
    const row = { combo, want, got, ok };
    rows.push(row); onRow?.(row, rows);
  }
  m.logic.inputs.forEach((n) => bench.setInput(n, false));
  return rows;
}

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
