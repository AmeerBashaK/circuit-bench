# Circuit Bench

A circuit simulator, an electronics game and a microcontroller IDE that run in the browser, on Windows and on Android. You draw a circuit, power it, and see real currents and voltages. Parts that are pushed past their ratings burn out, so mistakes are visible. The interface is a monochrome sci-fi HUD built with [Monohud](https://github.com/jshguo-labs/monohud).

**Live demo:** https://ameerbashak.github.io/circuit-bench/

The original single-file version of the simulator is on the `main` branch. This `monohud` branch is the full rebuild described here.

## The three modes

### Simulator

An open, infinite bench for building any circuit from wires, resistors, capacitors, diodes, LEDs, NPN and PNP transistors, switches, push buttons, and DC and AC sources.

- Current flows along the wires as moving dots, LEDs glow with their real brightness, and capacitors charge and discharge.
- Overloaded parts fail with their own effect: LEDs and diodes burst, capacitors explode, resistors burn, transistors crack.
- Select any part to see its voltage and current on the probe plot, its health bar and its load against its rating.
- Load an example circuit, or save your circuit to a `.cbench` file and open it again later.

### Missions

Fifty hand-made levels in six chapters that teach electronics one idea at a time, from closing your first loop to building a full adder out of transistors and diodes. Most levels set goals that must hold for a few seconds (an LED between 12 and 18 mA, a capacitor charged above 8 V). Logic levels are checked with a truth table: press **Test gate** and every input combination is tried in turn.

Levels open in order, so nobody can skip ahead. You can replay any level you have cleared, keep tinkering after clearing one, and repair burned parts without restarting. After level 50, endless generated levels keep getting tighter. See [docs/MISSIONS.md](docs/MISSIONS.md) for the full list.

### Maker IDE

A microcontroller bench with a code editor, a serial monitor and a wiring bench.

- **Boards:** ESP32 DevKit V1 (30 pin), ESP32-C3 SuperMini, ESP32-S3 SuperMini, Arduino Uno R3, Arduino Mega 2560 and Raspberry Pi Pico.
- **Modules:** PIR motion sensor (HC-SR501), ultrasonic sensor (HC-SR04), soil moisture sensor, light sensor (LDR), IR obstacle sensor (FC-51), DHT11 temperature and humidity sensor, SSD1306 OLED display, LED with resistor, RGB LED, 7-segment display, SG90 servo, relay module, and a lamp with its own 12 V battery.
- **Components:** resistor, LED, diode, capacitor, NPN transistor, push button, slide switch, potentiometer and buzzer. These are solved electrically, so a missing resistor really does burn an LED or damage a pin.
- **Code:** write an Arduino-style sketch (`setup()` and `loop()`, `pinMode`, `digitalWrite`, `analogRead`, `Serial`, the SSD1306, Servo and DHT libraries) and press **Upload & run**. The editor colours each kind of code element, and a checker points to the exact line of a mistake in plain words, such as "Line 12: missing ; at the end of the line."
- **Wiring:** drag from pin to pin. Wires route themselves with straight lines and right-angle turns and never run on top of each other.
- **Examples:** every example sketch sets up the circuit it needs on the bench, wired to the pins the code uses.
- **Lessons:** nine "what goes wrong when…" lessons load a mistake, show what happens and why, and apply the fix.
- **Save file:** saves the circuit and the code together in one `.cbench` file, so students can hand in work or carry it home.

## Using parts on the bench

Select a part first, then use it:

- click a selected switch or slide switch to flip it
- hold a selected push button to press it
- click a selected PIR sensor to wave a hand in front of it, or a selected IR sensor to put an object in front
- scroll on a selected knob or sensor (potentiometer, light, soil, distance, temperature) to turn it. Shift + scroll changes the DHT11's humidity.

## Controls

The desktop and the touch versions differ only in how you move around and select several parts at once.

| | Desktop (website, Windows app) | Touch (Android app, phones, tablets) |
| --- | --- | --- |
| Move around the bench | Drag empty space, or right-drag | **Pan** tool, or two fingers |
| Zoom | Scroll, or the − / Fit / + buttons | Pinch, or the − / Fit / + buttons |
| Select several parts | Shift + drag a box, or Shift + click | **Select** tool, then drag a box |

| Key | Action |
| --- | --- |
| 1 to 9, B | Pick a part to place (Simulator) |
| Q / X | Select / delete tool |
| Ctrl + Z / Ctrl + Y | Undo / redo |
| Ctrl + C / Ctrl + V / Ctrl + D | Copy / paste / duplicate |
| Ctrl + A | Select everything |
| Del | Delete the selection |
| F | Flip polarity |
| R | Rotate |
| Space | Pause or run |
| Ctrl + Enter | Upload & run the sketch (Maker IDE) |

**Settings** has a text colour choice and a "Force neon glow on all text" option for anyone who finds dim text hard to read.

## Run it

```bash
npm install
npm run dev      # development server on http://127.0.0.1:5190
npm run build    # static site in Output/dist
```

To build the Windows EXE or the Android APK, see [docs/BUILDING.md](docs/BUILDING.md).

## How it works

Both benches solve the circuit the way SPICE-style simulators do: modified nodal analysis, with Newton-Raphson iteration for the non-linear parts (Shockley model for diodes and LEDs, Ebers-Moll for transistors) and backward Euler for capacitors. Failure times are sped up so you can see them happen.

In the Maker IDE, the sketch is translated from Arduino C++ into JavaScript in the browser. `delay()` becomes a real pause without freezing the page, and every pin read or write goes through the electrical solver, so the code and the circuit always agree. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a tour of the code.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organised, how each part works, and how to add parts, boards, levels and examples
- [docs/MISSIONS.md](docs/MISSIONS.md): all 50 levels, what each one teaches and how levels are checked
- [docs/BUILDING.md](docs/BUILDING.md): building the website, the Windows EXE and the Android APK, and hosting on GitHub Pages
