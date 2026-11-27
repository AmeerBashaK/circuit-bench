# Circuit Bench

A circuit simulator that runs in the browser. Draw a circuit, power it, and see which parts survive. This branch restyles it as a monochrome sci-fi HUD built on [Monohud](https://github.com/jshguo-labs/monohud), and adds a game mode and a microcontroller IDE.

**Live demo:** https://ameerbashak.github.io/circuit-bench/

## Modes

- **Simulator:** an infinite bench. Drag empty space to pan, Shift+drag to box-select, scroll to zoom, and press Fit to frame the circuit. Save a circuit to a file and open it again later.
- **Missions:** 50 hand-made levels in six chapters (Basics, Resistors, LEDs, Diodes and capacitors, Transistors, Logic) that build from closing a loop to a full adder made of transistors and diodes. Goal levels must hold for a few seconds; logic levels are checked with a truth table. Levels open in order, and endless generated levels follow.
- **Maker IDE:** an ESP32 DevKit, ESP32-C3 SuperMini, ESP32-S3 SuperMini, Arduino Uno, Arduino Mega or Raspberry Pi Pico on a wiring bench, with sensors (PIR, HC-SR04, soil moisture, LDR, IR, DHT11), an SSD1306 OLED, servo, relay with lamp, RGB LED, 7-segment display and discrete parts. Write an Arduino-style sketch, upload it and watch the serial monitor. Every example sketch sets up its own circuit, nine failure lessons show what goes wrong and how to fix it, and the code checker points to the exact line of a mistake.

## What it does

- Wires, resistors, capacitors, diodes, LEDs, NPN/PNP transistors, switches, push buttons, DC and AC sources.
- Select a part, then use it: click a selected switch to flip it, hold a selected push button to press it, scroll on a selected knob or sensor to turn it.
- Undo and redo, group select, copy and paste in every mode.
- Current flows along the wires, LEDs glow, and capacitors charge.
- Overloaded parts fail: LEDs and diodes burst, capacitors explode, resistors burn, transistors crack. A failure tears the display and flashes the alert edge red.
- The probe plots the selected part's voltage and current. Every part has a health bar and a load-vs-rating gauge.

## How it works

Nodal analysis with Newton-Raphson iteration for the diodes, LEDs and transistors (Shockley and Ebers-Moll models), and backward Euler for the capacitors. Failure times are sped up so you can see them.

## Run it

```bash
npm install
npm run dev
```

`npm run build` writes the static site to `Output/dist`.

## Controls

| Key | Action |
| --- | --- |
| 1 to 9 | Pick a part |
| Q / X | Select / delete tool |
| Ctrl + Z / Y | Undo / redo |
| Ctrl + C / V | Copy / paste |
| Del | Delete the selected part |
| F | Flip polarity |
| R | Rotate the transistor |
| Space | Pause or run |
| Esc | Back to the select tool |

The original single-file version is on the `main` branch.
