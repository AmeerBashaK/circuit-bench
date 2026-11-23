# Circuit Bench

A circuit simulator that runs in the browser. Draw a circuit, power it, and see which parts survive. This branch restyles it as a monochrome sci-fi HUD built on [Monohud](https://github.com/jshguo-labs/monohud), and adds a game mode.

**Live demo:** https://ameerbashak.github.io/circuit-bench/

## Modes

- **Simulator:** an infinite bench. Drag empty space to pan, scroll to zoom, and press Fit to frame the circuit.
- **Missions:** levels that ask for a working circuit, such as an LED at 12 to 18 mA or a light that stays on after the battery is cut. Every goal must hold for a few seconds. Burn a part and the mission fails. Clearing a level unlocks the next one. Ten hand-made levels lead into endless generated ones that get tighter each time.

## What it does

- Wires, resistors, capacitors, diodes, LEDs, NPN/PNP transistors, switches, DC and AC sources.
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
| Q / H / X | Select / pan / delete tool |
| Del | Delete the selected part |
| F | Flip polarity |
| R | Rotate the transistor |
| Space | Pause or run |
| Esc | Back to the select tool |

The original single-file version is on the `main` branch.
