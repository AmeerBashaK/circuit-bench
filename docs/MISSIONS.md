# Missions

Missions teach electronics in small steps. Each level adds one new idea to what the previous levels taught, so a student who clears all fifty can build logic gates, and then a full adder, from nothing but resistors, diodes and transistors.

## How a level works

Every level places some locked parts on the bench (marked with a ◆), limits which parts can be added, and states a goal.

- **Goal levels** list conditions the live circuit must meet, such as "LED1 between 12 and 18 mA" or "No part above its rating". All of them must stay true together for a few seconds of simulated time. If a part burns out, the level fails; **Repair parts** fixes it without restarting.
- **Truth-table levels** (the two switch levels and the whole Logic chapter) have input switches and output meters. Press **Test gate** and the game sets every input combination in turn, lets the circuit settle and reads each output. An output counts as HIGH at 3.0 V or more and LOW at 1.5 V or less, so a gate must be clearly one or the other. Some levels also limit which parts may be used (for example "no transistors"), and wiring an output straight to an input is not allowed.

Clearing a level unlocks the next one. Levels cannot be skipped, but any cleared level can be replayed. After a clear, the player can **keep tinkering** with the working circuit or move on. **Restart** can be undone with Ctrl + Z.

Every hand-made level has a hidden reference solution in `src/missions.js`. A test builds each solution in the real simulator and checks it passes, so every level is proven to be winnable.

## The levels

### Basics (1 to 6)

| # | Level | What it teaches |
| --- | --- | --- |
| 1 | Close the loop | Current needs a complete loop |
| 2 | First light | An LED needs a series resistor |
| 3 | Flip the switch | A switch goes in series with what it controls |
| 4 | Push to light | A push button is a switch that springs back |
| 5 | Dial it in | Current ≈ (supply − LED voltage) ÷ R |
| 6 | Two in series | Resistors in a row add up |

### Resistors (7 to 12)

| # | Level | What it teaches |
| --- | --- | --- |
| 7 | Side by side | Resistors in parallel share the current |
| 8 | Halfway there | A voltage divider |
| 9 | Power for a chip | Choosing divider values for 3.3 V |
| 10 | Bright and dim | Each LED gets its own resistor |
| 11 | Power budget | Spreading power across resistors |
| 12 | Odd value | Combining series and parallel |

### LEDs (13 to 18)

| # | Level | What it teaches |
| --- | --- | --- |
| 13 | Two in a row | LEDs in series share one current |
| 14 | Three at once | Parallel LED branches |
| 15 | Rainbow rail | Different colours drop different voltages |
| 16 | Both switches | Switches in series behave like AND (truth table) |
| 17 | Either switch | Switches in parallel behave like OR (truth table) |
| 18 | The gauntlet | Keeping every part well under its rating |

### Diodes and capacitors (19 to 24)

| # | Level | What it teaches |
| --- | --- | --- |
| 19 | One way only | A diode passes current in one direction |
| 20 | Drop with diodes | Each diode drops about 0.7 V |
| 21 | Charge up | A capacitor stores charge |
| 22 | Afterglow | A capacitor keeps an LED lit after power is cut |
| 23 | Tame the AC | Rectifying and smoothing AC to light an LED |
| 24 | Make DC from AC | A simple power supply |

### Transistors (25 to 30)

| # | Level | What it teaches |
| --- | --- | --- |
| 25 | Small current, big light | A transistor switches a large current with a small one |
| 26 | Gain | Collector current is about 100 times the base current |
| 27 | Two lights, one switch | One transistor driving two loads |
| 28 | Super gain | Two transistors chained (Darlington) |
| 29 | Delay off | A capacitor on the base keeps the transistor on |
| 30 | Heavy load | Switching a 24 V string safely |

### Logic (31 to 50)

All checked with a truth table.

| # | Level | What it teaches |
| --- | --- | --- |
| 31 | Transistor switch | A buffer: the output follows the input |
| 32 | NOT gate | An inverter |
| 33 | Double NOT | Two inversions cancel out |
| 34 | OR gate from diodes | Diode logic |
| 35 | AND gate from diodes | Diode logic with a pull-up |
| 36 | Three-way OR | More inputs |
| 37 | Three-way AND | More inputs |
| 38 | NOR gate | Transistors in parallel under one pull-up |
| 39 | NAND gate | Transistors stacked in series |
| 40 | Three-way NOR | Three in parallel |
| 41 | Three-way NAND | Three in series |
| 42 | AND gate from transistors | NAND followed by NOT |
| 43 | OR gate from transistors | NOR followed by NOT |
| 44 | A but not B | Combining a NOT with an AND |
| 45 | XOR gate | "A or B" and "not both" |
| 46 | Same or different | XNOR: an XOR followed by a NOT |
| 47 | Majority vote | At least two of three inputs |
| 48 | Half adder | Sum (XOR) and carry (AND) |
| 49 | Selector | A 2-to-1 multiplexer |
| 50 | Full adder | Adding three bits: A + B + carry in |

### After level 50

Endless "Calibration" levels are generated from the level number: odd supply voltages, narrower current windows and lower stress ceilings each time.

## Adding a level

Levels live in `src/missions.js`, grouped into the chapter arrays `BASICS`, `RESISTORS`, `LEDS`, `DIODES`, `TRANSISTORS` and `LOGIC`. A goal level looks like this:

```js
{
  title: 'Dial it in',
  brief: 'Run the green LED at 12 to 18 mA from 9 V.',
  hint: 'Current ≈ (supply − LED voltage) ÷ R.',
  allowed: ['wire', 'resistor'],      // parts the player may add
  hold: 3,                            // seconds every goal must stay true
  setup: (add) => sourceAndLed(add, 9, 'green'),   // locked parts
  goals: [{ text: 'LED1 between 12 and 18 mA', test: (b) => leds(b).some((e) => inWindow(e, mA(12), mA(18))) }],
  solution: (add) => { R(add, P(-10, -4), P(8, -4), 450); home(add, P(8, 4)); },  // hidden proof
}
```

Logic levels use the `gate(...)` helper, which builds the standard bench (5 V supply, rails, input switches, output meters) and adds a `logic` block with the inputs, outputs, truth function and part limits.

Always give a new level a `solution` (and an `act` if the player has to press or flip something), then run the level test to prove it can be won.
