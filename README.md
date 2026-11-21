# Circuit Bench

A small circuit simulator that runs in the browser. Draw a circuit, power it, and see which parts survive.

**Live demo:** https://ameerbashak.github.io/circuit-bench/

## What it does

- Draw series and parallel circuits on a grid with wires, resistors, capacitors, diodes, LEDs, NPN/PNP transistors and switches.
- Power them with a DC battery or an AC source (adjustable voltage, frequency and internal resistance).
- Flip the polarity of any part, replace it with another part, or delete it.
- Watch current flow along the wires, LEDs glow, and capacitors charge.
- Overload a part and it fails with an animation: LEDs and diodes burst, capacitors bulge and explode, resistors smoke and burn, transistors overheat and crack. Failed parts become open circuits.
- Plot the selected part's voltage and current over time, and the health of every part.

Six examples are included, such as an LED with no resistor, a capacitor wired backwards, a transistor switch and an AC rectifier.

## How it works

The simulator uses nodal analysis with Newton-Raphson iteration for the diodes, LEDs and transistors (Shockley and Ebers-Moll models), and backward Euler for the capacitors. Failure times are sped up so you can see them.

## Run it

It is a single HTML file with no build step. Open `index.html` in a browser, or use the live demo.

## Controls

| Key | Action |
| --- | --- |
| Del | Delete the selected part |
| F | Flip polarity |
| R | Rotate the transistor |
| Space | Pause or run |
| Esc | Back to the select tool |
