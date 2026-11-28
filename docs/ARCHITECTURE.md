# Architecture

Circuit Bench is a single-page React app built with Vite. It has no server: everything, including the circuit solvers and the sketch runtime, runs in the browser. The Windows and Android apps wrap the same built files (see [BUILDING.md](BUILDING.md)).

## Files

```
src/
  main.jsx           Entry point: fonts, Monohud styles, mounts <App>
  App.jsx            Shell: header, mode tabs, Simulator and Missions panels, Settings, Inspector
  app.css            All layout and styling (Monohud provides the base components)
  engine.js          Simulator and Missions bench: parts, solver, canvas drawing, editing, undo
  models.js          Device models shared by both solvers (diode/LED, transistor, LED colours)
  missions.js        The 50 levels, goal checks, truth-table test, endless levels
  projectFile.js     Saving and opening .cbench project files
  platform.js        Desktop vs touch behaviour switch
  ide/
    IDE.jsx          Maker IDE: toolbar, code editor, wiring bench, parts panel, serial monitor
    boards.js        Boards, parts, the netlist, starter layouts and pin naming
    bench.js         Wiring bench canvas: drawing, dragging, wiring, selection, failure effects
    router.js        Automatic wire routing (A* on a grid, right angles only)
    circuit.js       Electrical solver for the Maker bench, board power and pin damage
    runtime.js       Arduino C++ to JavaScript translation and the simulated board API
    lint.js          Beginner code checker and friendly error messages
    highlight.js     Syntax colouring for the code editor
    examples.js      Example sketches and the circuits they need
    lessons.js       The nine failure lessons
packaging/
  copy-web.mjs       Copies the built site into the desktop or Android project
  desktop/           Electron wrapper for the Windows EXE
  android/           Capacitor wrapper for the Android APK
  icon/              App icon and the script that draws it
```

## Simulator and Missions: `engine.js`

`createBench(canvas, …)` returns one bench object used by both the Simulator and Missions.

- **Parts** are plain objects with a type, two end points on the grid (a transistor has one point and a rotation), properties such as resistance or colour, and live values (current, power, stress, heat).
- **Topology:** every terminal on the same grid point is one node. A wire is split wherever another terminal lands on it, so a wire passing over a junction connects to it. Wires are low-resistance parts in the solver, not merged nodes.
- **Solver:** modified nodal analysis. Each step builds the conductance matrix, stamps every part, and solves it with LU decomposition. Diodes, LEDs and transistors are non-linear, so the step repeats (Newton-Raphson, with voltage limiting) until it converges. Capacitors use backward Euler. Ground is the minus end of the first source.
- **Stress and failure:** every part compares its current or power against its rating. Above the rating, heat builds up over time; when it reaches the limit the part fails, its effect plays (sparks, smoke, a flash, a shake) and the solver treats it as open.
- **Editing:** tools for each part, select, pan and delete; group selection with a box or Shift + click; copy, paste and duplicate; undo and redo as snapshots of the layout. The open bench is saved to `localStorage` after every change.
- **Missions API:** `load(setup, { allowed })` places a level's locked parts and limits the toolbox; `setInput`, `voltageAt` and `wiredTogether` let the truth-table test flip input switches and read outputs.

## Missions: `missions.js`

Each level has a brief, a hint, the parts allowed, a `setup` that places locked parts, and either goals (checked every frame in `App.jsx`, all true for `hold` seconds) or a `logic` block (checked by `truthTest`). Each also carries a hidden `solution`, which the level test builds to prove it can be won. Progress is stored in `localStorage` under `cbh-unlocked`. See [MISSIONS.md](MISSIONS.md).

## Maker IDE

### Layout and netlist: `boards.js`

A layout is plain data: the board, the parts with their positions, and the wires as pairs of pin keys (`"part-id:PIN"`). `netlist(layout)` joins pins into nets with union-find, adding the links a real board has inside it (all GND pins, both pins that share a GPIO, every hole on a power rail strip). It reports which parts are powered, which GPIOs each part pin reaches, and whether power is shorted to GND.

`defaultLayout(board, parts)` builds a starter bench: the board, a power rail, and each part powered from the rail and wired to the board's default pin for its role. `sketchPins` reads the wiring back as pin names, so example sketches always use the pins that are actually wired.

### Wiring bench: `bench.js` and `router.js`

The bench draws the board, parts and wires on a canvas with a pan and zoom camera. Wires are routed by `router.js`: an A* search on the grid that only moves in straight lines, turns at right angles, avoids parts, and never lets two wires share a segment (crossing is allowed). The bench handles dragging parts and groups, drawing and re-pinning wires, box selection, using selected parts (clicking a switch, scrolling a knob), and the failure effects.

### Electrical solver: `circuit.js`

The same nodal analysis as the Simulator, run on the netlist. Board power pins and GPIO outputs are voltage sources with a small internal resistance; `INPUT_PULLUP` is a 45 kΩ pull-up; sensors drive their outputs from their settings. `digitalRead` and `analogRead` read the real node voltage, so a floating pin or a weak divider behaves like the real thing. The board also has limits: a GPIO carrying too much current is warned about and then dies, and a supply short trips the board like a fuse until the short is removed.

### Sketch runtime: `runtime.js`

`transpile()` turns the sketch into JavaScript with a series of rewrites: `#define` becomes `const`, typed declarations become `let`, functions become `async`, and calls to `delay`, `pulseIn` and the sketch's own functions get `await`. That lets `delay(500)` pause without blocking the page. The translated code keeps the same line numbers as the sketch, so runtime errors point at the student's own line.

`createRuntime()` provides the Arduino API: pins, ADC, `millis`, `Serial` (with baud-rate mismatch shown as garbled text), the SSD1306 display drawn into a 128 × 64 bitmap, `Servo` and `DHT`. Every pin call goes to the circuit solver.

### Code checking and colouring: `lint.js` and `highlight.js`

Before upload, `lintSketch` reads the original source and reports beginner mistakes with exact line numbers: missing semicolons, unmatched or unclosed brackets, unclosed quotes, wrong capital letters on known names (`digitalwrite`), a missing `setup` or `loop`, and warnings for `=` inside a condition or a stray `;` after `if (...)`. `friendlyError` rewrites runtime errors in plain words.

`highlight.js` splits the sketch into tokens (comments, strings, numbers, `#` lines, keywords, types, Arduino functions, objects, constants, the student's own functions, variables, operators and punctuation). The editor draws them in colour on a layer under a transparent textarea, so typing, selection and undo stay native.

## Project files: `projectFile.js`

A `.cbench` file is JSON:

```json
{ "app": "circuit-bench", "version": 1, "kind": "maker", "saved": "…", "layout": { … }, "code": "…" }
```

`kind` is `simulator` (with a `circuit` array of parts) or `maker` (with `layout` and `code`). Files can come from anywhere, so opening one checks every part, point and wire before it touches the bench, and refuses files from the other mode, from a newer version, or that are damaged. Opening a file is a single undo step.

## Desktop and touch: `platform.js`

`touchUI` is true inside the Android app (Capacitor) or on a touch-first screen. Touch gets separate **Select** and **Pan** tools (there is no Shift key), two-finger pan and pinch zoom, a fixed-height code editor that scrolls inside itself, and in the Maker IDE a swipeable carousel (`Carousel` in `IDE.jsx`) with the wiring bench on one slide and the display stacked over the serial monitor on the other. The desktop keeps drag-to-pan and Shift + drag to box-select.

## Adding things

- **A Simulator part:** add it to `TYPES` and `TOOLS` in `engine.js`, stamp it in the solver, compute its current and stress, and draw it.
- **A Maker part:** add it to `PARTS` in `boards.js` (size, pins, starting settings) and to `MODULES` or `COMPONENTS`; stamp it in `circuit.js` if it is electrical; draw it in `bench.js`; add its controls in the parts panel in `IDE.jsx`; and add any library calls it needs to `runtime.js` (and their names to `SKETCH_NAMES` so the checker knows them).
- **A board:** add a function in `boards.js` that lists its pins in order around the board with their GPIO numbers, ADC pins, I2C pins, onboard LED, logic voltage and default pins for each part role, then add it to `BOARDS`.
- **An example:** add an entry to `SKETCHES` in `examples.js` with the parts it needs and the code, using `{{NAME}}` placeholders for pins (filled from the wiring by `sketchPins`).
- **A level:** see [MISSIONS.md](MISSIONS.md).
