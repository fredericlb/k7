// What a one-knob filter can get silently wrong: which half of the travel does what, and
// whether the middle really is transparent. Neither is visible in the sound until somebody has
// already swept it across a full room.

import { describe, expect, it } from "vitest";
import {
  HIGH_SWEEP,
  LOW_SWEEP,
  SWEEP_Q,
  SWEEP_RANGE,
  sweepFilter,
} from "./sweep";

describe("the sweep filter graph", () => {
  const g = sweepFilter();
  const biquads = g.nodes.filter((n) => n.type === "biquad");

  it("takes ONE control, centred on neutral", () => {
    // The brief and the constraint at once: a desk control drives at most one param, so
    // "low-pass or high-pass" cannot be a second setting. Signed, so the neutral position is
    // the middle of the travel rather than one end of it.
    expect(g.params.map((p) => p.name)).toEqual(["Sweep"]);
    const p = g.params[0];
    expect(p.min).toBe(SWEEP_RANGE.min);
    expect(p.max).toBe(SWEEP_RANGE.max);
    expect(p.default).toBe(0);
    expect(-p.min).toBe(p.max);
  });

  it("keeps BOTH filters in the chain, low-pass first", () => {
    // Always both, because the knob cannot switch between them. Their order is not arbitrary
    // either: the low-pass runs first, so what the high-pass sees at the far left is already
    // the muffled signal rather than the raw one.
    expect(biquads.map((n) => n.mode)).toEqual(["lowpass", "highpass"]);
  });

  it("puts both corners OUTSIDE the material at rest", () => {
    // The centre has to be inaudible, and it is inaudible by geometry rather than by a bypass:
    // 20 kHz is above anything in a song and 20 Hz below it. A module that had to be removed
    // to be silent is one a chain could not automate from nothing.
    expect(LOW_SWEEP.open).toBeGreaterThanOrEqual(20000);
    expect(HIGH_SWEEP.open).toBeLessThanOrEqual(20);
    // …and each end really does close: the two are travelled in opposite directions.
    expect(LOW_SWEEP.closed).toBeLessThan(LOW_SWEEP.open);
    expect(HIGH_SWEEP.closed).toBeGreaterThan(HIGH_SWEEP.open);
  });

  it("leaves a gap between the two ends, rather than meeting in the middle", () => {
    // If the high-pass climbed as far as the low-pass falls, the two halves would sound like
    // mirror images — and the right-hand one would take the whole track out well before the
    // knob's end. Sweeping the bass away is a build; it stops at air.
    expect(HIGH_SWEEP.closed).toBeLessThan(LOW_SWEEP.closed * 100);
    expect(HIGH_SWEEP.closed).toBeGreaterThan(LOW_SWEEP.closed);
  });

  it("smooths both corners, because this is a knob people THROW", () => {
    // A biquad recomputes its coefficients per block. Without this a fast sweep is a stream of
    // coefficient jumps — a zipper, which reads as a broken filter rather than a quick one.
    expect(g.nodes.filter((n) => n.type === "glide")).toHaveLength(2);
  });

  it("holds the resonance fixed and modest", () => {
    // The famous sound of this effect, and the way it takes somebody's headroom mid-set. A
    // second knob for it would have to be bound and drawn; this is the value that never
    // surprises.
    expect(SWEEP_Q).toBe(1);
    for (const n of biquads) expect(n.in?.at(-1)).toBe(SWEEP_Q);
  });
});
