// Failure lessons: each one sets up a common wiring mistake on an Arduino Uno behind a slide switch (S1),
// so the student flips the switch and watches the part fail. "Apply the fix" rewires it the right way
// with the same part ids, so the switch stays where the student left it.
import { defaultLayout } from './boards.js';

/** Board plus the power rail and its two supply wires; everything else is added by the lesson. */
function bench(board = 'uno') {
  const L = defaultLayout(board);
  return {
    ...L,
    objects: L.objects.filter((o) => o.kind === 'board' || o.type === 'rail'),
    wires: L.wires.filter((w) => w.a.startsWith('board:') && w.b.startsWith('rail:')),
  };
}

// Rail holes are named by position: '+i' and '−i' sit at x = i + 1.
const plus = (x) => `rail:+${x - 1}`, gnd = (x) => `rail:−${x - 1}`;

function build(fn) {
  const L = bench(), n = { w: 0 };
  const part = (id, type, x, y, props) => L.objects.push({ id, kind: 'part', type, x, y, rot: 0, ...(props ? { props } : {}) });
  const wire = (a, b) => L.wires.push({ id: `lw${n.w++}`, a, b });
  // S1 sits under the rail and takes 5 V from it; S1:2 is the switched supply for the lesson.
  part('s1', 'toggle', 3, 18); wire('s1:1', plus(4));
  fn(part, wire);
  return L;
}

export const LESSONS = [
  {
    id: 'led-no-resistor',
    title: 'LED with no resistor',
    try: 'Turn on S1.',
    happens: 'The LED flashes bright for a moment, then pops and goes dark for good.',
    why: 'An LED does not limit its own current. Straight from 5 V it tries to pass amps, and it is rated for 30 mA.',
    fix: 'Put a 220 Ω resistor in series. That keeps the current near 14 mA.',
    broken: () => build((part, wire) => { part('led', 'ledc', 9, 21); wire('s1:2', 'led:A'); wire('led:K', gnd(12)); }),
    fixed: () => build((part, wire) => { part('r', 'resistor', 9, 21, { R: 220 }); part('led', 'ledc', 15, 21); wire('s1:2', 'r:1'); wire('r:2', 'led:A'); wire('led:K', gnd(18)); }),
  },
  {
    id: 'resistor-too-small',
    title: 'Resistor too small for its rating',
    try: 'Turn on S1 and watch R1.',
    happens: 'R1 glows, smokes, catches fire and ends up scorched. After that, no current flows.',
    why: 'A 47 Ω resistor across 5 V turns about 0.5 W into heat. A ¼ W resistor can only get rid of 0.25 W.',
    fix: 'Use 470 Ω. Now it only has to handle about 50 mW.',
    broken: () => build((part, wire) => { part('r', 'resistor', 9, 21, { R: 47, P: 0.25 }); wire('s1:2', 'r:1'); wire('r:2', gnd(14)); }),
    fixed: () => build((part, wire) => { part('r', 'resistor', 9, 21, { R: 470, P: 0.25 }); wire('s1:2', 'r:1'); wire('r:2', gnd(14)); }),
  },
  {
    id: 'cap-backwards',
    title: 'Capacitor wired backwards',
    try: 'Turn on S1 and watch C1.',
    happens: 'C1 swells, shakes and bursts.',
    why: 'An electrolytic capacitor has a + leg. Charged the wrong way round, the insulating layer inside breaks down and it heats up fast.',
    fix: 'Turn it round: + to the supply, − to GND.',
    broken: () => build((part, wire) => { part('c', 'cap', 9, 21, { C: 100, Vmax: 16 }); wire('s1:2', 'c:−'); wire('c:+', gnd(13)); }),
    fixed: () => build((part, wire) => { part('c', 'cap', 9, 21, { C: 100, Vmax: 16 }); wire('s1:2', 'c:+'); wire('c:−', gnd(13)); }),
  },
  {
    id: 'cap-overvoltage',
    title: 'Capacitor voltage rating too low',
    try: 'Turn on S1.',
    happens: 'C1 charges, swells and bursts, even though it is the right way round.',
    why: 'This capacitor is rated for 2.5 V and the supply is 5 V. Every capacitor has a voltage it must not go above.',
    fix: 'Use a capacitor rated well above the supply, for example 16 V.',
    broken: () => build((part, wire) => { part('c', 'cap', 9, 21, { C: 100, Vmax: 2.5 }); wire('s1:2', 'c:+'); wire('c:−', gnd(13)); }),
    fixed: () => build((part, wire) => { part('c', 'cap', 9, 21, { C: 100, Vmax: 16 }); wire('s1:2', 'c:+'); wire('c:−', gnd(13)); }),
  },
  {
    id: 'buzzer-backwards',
    title: 'Buzzer wired backwards',
    try: 'Turn on S1.',
    happens: 'The buzzer crackles, smokes and never makes a sound again.',
    why: 'An active buzzer has a small circuit inside, and it only works one way round. The longer leg, marked +, goes to the supply.',
    fix: 'Swap the legs: + to the switch, − to GND.',
    broken: () => build((part, wire) => { part('bz', 'buzzer', 9, 18); wire('s1:2', 'bz:−'); wire('bz:+', gnd(10)); }),
    fixed: () => build((part, wire) => { part('bz', 'buzzer', 9, 18); wire('s1:2', 'bz:+'); wire('bz:−', gnd(12)); }),
  },
  {
    id: 'diode-no-resistor',
    title: 'Diode straight across the supply',
    try: 'Turn on S1.',
    happens: 'D1 flashes white, sparks and cracks.',
    why: 'Once a diode conducts, it acts almost like a wire. Across 5 V it passes far more than its 200 mA rating.',
    fix: 'Add a resistor in series, so something limits the current.',
    broken: () => build((part, wire) => { part('d', 'diode', 9, 21); wire('s1:2', 'd:A'); wire('d:K', gnd(12)); }),
    fixed: () => build((part, wire) => { part('r', 'resistor', 9, 21, { R: 220 }); part('d', 'diode', 15, 21); wire('s1:2', 'r:1'); wire('r:2', 'd:A'); wire('d:K', gnd(18)); }),
  },
  {
    id: 'transistor-no-base-resistor',
    title: 'Transistor with no base resistor',
    try: 'Turn on S1. The transistor is meant to switch the LED on.',
    happens: 'Q1 overheats, smokes and cracks, and the LED never lights.',
    why: 'The base behaves like a diode to the emitter. With nothing in between, 5 V on the base pushes a huge current through it.',
    fix: 'Put a 1 kΩ resistor between the switch and the base. A few milliamps into the base is enough to switch the LED.',
    broken: () => build((part, wire) => {
      part('q', 'npn', 10, 18); part('rl', 'resistor', 17, 21, { R: 220 }); part('led', 'ledc', 23, 21, { color: 'green' });
      wire('s1:2', 'q:B'); wire('q:E', gnd(11)); wire('rl:1', plus(16)); wire('rl:2', 'led:A'); wire('led:K', 'q:C');
    }),
    fixed: () => build((part, wire) => {
      part('rb', 'resistor', 3, 24, { R: 1000 }); part('q', 'npn', 10, 18); part('rl', 'resistor', 17, 21, { R: 220 }); part('led', 'ledc', 23, 21, { color: 'green' });
      wire('s1:2', 'rb:1'); wire('rb:2', 'q:B'); wire('q:E', gnd(11)); wire('rl:1', plus(16)); wire('rl:2', 'led:A'); wire('led:K', 'q:C');
    }),
  },
  {
    id: 'pin-to-gnd',
    boardLesson: true,
    title: 'Output pin wired straight to GND',
    try: 'Press Upload & run. The sketch sets pin 7 HIGH.',
    happens: 'Pin 7 sparks, the chip smokes and the pin gets a red cross. It no longer drives anything.',
    why: 'HIGH means the pin tries to hold 5 V. Wired to GND, it pushes over 100 mA, and an Uno pin is rated for about 40 mA.',
    fix: 'Drive the LED through a 220 Ω resistor and let the LED go to GND. Then press Replace board.',
    code: `// Lesson: pin 7 is wired straight to GND.
void setup() {
  Serial.begin(115200);
  pinMode(7, OUTPUT);
}

void loop() {
  digitalWrite(7, HIGH);
  Serial.println("Pin 7 is HIGH");
  delay(1000);
}
`,
    broken: () => { const L = bench(); L.wires.push({ id: 'lw0', a: 'board:7', b: gnd(26) }); return L; },
    fixed: () => {
      const L = bench();
      L.objects.push({ id: 'r', kind: 'part', type: 'resistor', x: 22, y: 21, rot: 0, props: { R: 220 } }, { id: 'led', kind: 'part', type: 'ledc', x: 28, y: 21, rot: 0 });
      L.wires.push({ id: 'lw0', a: 'board:7', b: 'r:1' }, { id: 'lw1', a: 'r:2', b: 'led:A' }, { id: 'lw2', a: 'led:K', b: gnd(32) });
      return L;
    },
  },
  {
    id: 'power-short',
    boardLesson: true,
    title: 'Switch shorting 5 V to GND',
    try: 'Turn on S1.',
    happens: 'A big flash, sparks and smoke. The board goes dark with NO POWER and stays off while S1 is on.',
    why: 'S1 joins the 5 V rail straight to GND, so nothing limits the current. The board shuts its power off to protect itself.',
    fix: 'Never switch power straight into GND. Put a load in between, like a 220 Ω resistor and an LED.',
    broken: () => build((part, wire) => { wire('s1:2', gnd(8)); }),
    fixed: () => build((part, wire) => { part('r', 'resistor', 9, 21, { R: 220 }); part('led', 'ledc', 15, 21); wire('s1:2', 'r:1'); wire('r:2', 'led:A'); wire('led:K', gnd(18)); }),
  },
];

export const LESSON_ITEMS = LESSONS.map((l) => ({ value: l.id, label: l.title }));
