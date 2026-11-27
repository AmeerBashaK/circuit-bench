// Semiconductor models shared by the Simulator bench (engine.js) and the Maker IDE bench (ide/circuit.js).
// Shockley diodes with reverse breakdown, Ebers-Moll transistors, and SPICE-style junction limiting.

export const VT = 0.02585;
export const LEDC = {
  red: { vf: 1.8, c: '#ff4433' }, yellow: { vf: 2.0, c: '#ffcc22' }, green: { vf: 2.2, c: '#3ad16b' },
  blue: { vf: 3.0, c: '#4a8dff' }, white: { vf: 3.1, c: '#f4f6ff' },
};

/** Limits a junction voltage step so Newton-Raphson does not overshoot the exponential. */
export function pnj(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) { const arg = 1 + (vnew - vold) / vt; vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit; }
    else vnew = vt * Math.log(vnew / vt);
  }
  return vnew;
}

/** Diode parameters; an LED is a diode whose forward voltage depends on its colour. */
export function dpar(isLed, color) {
  let Is, nn, BV;
  if (isLed) { const vf = LEDC[color].vf; nn = 2; Is = 0.01 / Math.exp(vf / (nn * VT)); BV = 5; }
  else { Is = 1e-14; nn = 1; BV = 100; }
  const nvt = nn * VT, Isb = 1e-10, vtb = VT;
  return { Is, nvt, BV, Isb, vtb, vcrit: nvt * Math.log(nvt / (Math.SQRT2 * Is)), vcritb: vtb * Math.log(vtb / (Math.SQRT2 * Isb)) };
}

/** Current and conductance at junction voltage v. */
export function dcalc(v, m) {
  const ef = Math.exp(Math.min(v / m.nvt, 80)), eb = Math.exp(Math.min(-(v + m.BV) / m.vtb, 80));
  return [m.Is * (ef - 1) - m.Isb * eb, m.Is / m.nvt * ef + m.Isb / m.vtb * eb + 1e-12];
}

export function dlimit(vraw, vold, m) {
  if (vraw >= 0) return pnj(vraw, vold, m.nvt, m.vcrit);
  const u = pnj(-(vraw + m.BV), -(vold + m.BV), m.vtb, m.vcritb); return -u - m.BV;
}

export const QIS = 1e-14, QVC = VT * Math.log(VT / (Math.SQRT2 * QIS));

/** Ebers-Moll transistor currents and small-signal conductances. */
export function qcalc(vbe, vbc, beta) {
  const eF = Math.exp(Math.min(vbe / VT, 80)), eR = Math.exp(Math.min(vbc / VT, 80)), bR = 1;
  const IF = QIS * (eF - 1), IR = QIS * (eR - 1), gF = QIS / VT * eF + 1e-12, gR = QIS / VT * eR + 1e-12;
  return { Ic: IF - IR - IR / bR, Ib: IF / beta + IR / bR, gF, gR, bR };
}
