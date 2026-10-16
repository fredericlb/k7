// hang.ts — a patch cable's SHAPE and its PHYSICS. The rest curve hangs between its two
// sockets (a stub out of each plate, then gravity), and a damped spring lets the slack lag
// and swing when its endpoints move. Pure math over points; the renderer draws it.
// See docs/hang.md for the model and the numbers.

import type { Pt } from "./graphNode";

// The droop grows with the HORIZONTAL run, which is what gravity does. See docs/hang.md.
export const HANG_DROOP_MIN = 6; // world px — even a short cable is not a ruler
export const HANG_DROOP_RATE = 0.22; // px of sag per px of horizontal run
export const HANG_DROOP_MAX = 72;
// The stub: how far a cable leaves a socket along the plate's axis, which reads as PLUGGED IN.
export const HANG_STUB_MIN = 14;
export const HANG_STUB_RATE = 0.25;
export const HANG_STUB_MAX = 60;
// Sampling of the rest curve, fine enough that the spline through the samples IS the bezier.
export const HANG_STEP = 14;
export const HANG_MAX_POINTS = 33; // 32 segments — cap so a screen-wide cable stays cheap

/** The rest polyline of a cable hanging OUT socket to IN socket; `across` is the mixer row's. docs/hang.md. */
export function hangPoints(
  from: Pt,
  to: Pt,
  across = false,
  step = HANG_STEP,
): Pt[] {
  const dx = to.x - from.x;
  const dist = Math.hypot(dx, to.y - from.y);
  if (dist < 1) return [from, to];
  const droop = Math.min(
    HANG_DROOP_MAX,
    HANG_DROOP_MIN + Math.abs(dx) * HANG_DROOP_RATE,
  );
  const stub = Math.min(HANG_STUB_MAX, HANG_STUB_MIN + dist * HANG_STUB_RATE);
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;
  if (across) {
    c1x = from.x + stub;
    c1y = from.y + droop;
    c2x = to.x - stub;
    c2y = to.y + droop;
  } else {
    c1x = from.x;
    c1y = from.y + stub + droop;
    c2x = to.x;
    c2y = to.y - stub + Math.min(droop, stub * 0.5);
  }
  const n = Math.max(8, Math.min(HANG_MAX_POINTS - 1, Math.round(dist / step)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x:
        u * u * u * from.x +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * to.x,
      y:
        u * u * u * from.y +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * to.y,
    });
  }
  return out;
}

// --- the swing -------------------------------------------------------------------

// One spring per cable, on the slack's offset from rest, excited by endpoint motion. docs/hang.md.
export const SWAY_K = 34; // spring rate, 1/s² — about a 1 Hz pendulum
export const SWAY_DAMP = 3.4; // underdamped on purpose: a visible swing, settled in ~a second
export const SWAY_COUPLE = 0.55; // how much of its ends' motion the slack inherits
export const SWAY_MAX = 46; // world px — however hard the cards move, slack is finite
export const SWAY_EPS = 0.15; // below this offset AND velocity, the cable is still

/** One cable's swing state, mutated in place — the draw loop owns thousands of frames. */
export interface CableSway {
  ox: number; // the slack's offset from the rest curve, world px
  oy: number;
  vx: number;
  vy: number;
  ax: number; // where the endpoints were last seen — their motion is the excitation
  ay: number;
  bx: number;
  by: number;
  seen: boolean;
}

export const newSway = (): CableSway => ({
  ox: 0,
  oy: 0,
  vx: 0,
  vy: 0,
  ax: 0,
  ay: 0,
  bx: 0,
  by: 0,
  seen: false,
});

/** Tell the spring where the endpoints ARE; the first sighting excites nothing. See docs/hang.md. */
export function exciteSway(s: CableSway, a: Pt, b: Pt): void {
  if (s.seen) {
    s.ox -= ((a.x - s.ax + b.x - s.bx) / 2) * SWAY_COUPLE;
    s.oy -= ((a.y - s.ay + b.y - s.by) / 2) * SWAY_COUPLE;
  }
  s.ax = a.x;
  s.ay = a.y;
  s.bx = b.x;
  s.by = b.y;
  s.seen = true;
}

/** One step of the damped spring (semi-implicit Euler); a settled cable is snapped to EXACT rest. */
export function stepSway(s: CableSway, dt: number): boolean {
  s.vx += (-SWAY_K * s.ox - SWAY_DAMP * s.vx) * dt;
  s.vy += (-SWAY_K * s.oy - SWAY_DAMP * s.vy) * dt;
  s.ox += s.vx * dt;
  s.oy += s.vy * dt;
  const mag = Math.hypot(s.ox, s.oy);
  if (mag > SWAY_MAX) {
    const f = SWAY_MAX / mag;
    s.ox *= f;
    s.oy *= f;
  }
  if (mag > SWAY_EPS || Math.hypot(s.vx, s.vy) > SWAY_EPS * 10) return true;
  s.ox = 0;
  s.oy = 0;
  s.vx = 0;
  s.vy = 0;
  return false;
}
