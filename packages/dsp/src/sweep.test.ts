// What a one-knob DJ filter can get silently wrong: which half of the travel does what,
// whether the middle really is silent, and — the one that made the first version sound like a
// tone control — whether anything RESONATES. None of it is visible until somebody has already
// swept it across a full room.

import { describe, expect, it } from "vitest";
import {
  HIGH_SWEEP,
  LOW_SWEEP,
  Q_MAX,
  Q_REST,
  SWEEP_RANGE,
  SWEEP_TRIM,
  sweepFilter,
} from "./sweep";

describe("the DJ filter graph", () => {
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

  it("RESONATES, which is the whole difference from a tone control", () => {
    // The bug this version exists for. A flat corner sliding across a track only muffles it,
    // progressively and dully — "a normal filter". The swoosh is a PEAK travelling with the
    // corner, and the peak is the effect.
    //
    // 6 is measured rather than chosen: white noise through the filter at half sweep gives
    // +3.9 dB at the corner and −21 dB an octave and a half above it. At 4 the peak came to
    // about +1 dB once the flat stage and the trim had taken theirs, which is audible and is
    // not a filter sweep.
    expect(Q_MAX).toBeGreaterThanOrEqual(6);
    // …and it is EARNED, not permanent: at rest the response is Butterworth, so a filter doing
    // nothing also colours nothing. A fixed high Q rings even parked out of the way.
    expect(Q_REST).toBeCloseTo(0.707, 3);
    expect(g.nodes.filter((n) => n.type === "lerp").length).toBeGreaterThanOrEqual(2);
  });

  it("gives each half its OWN resonance", () => {
    // Sharing one would leave the high-pass ringing at 20 Hz while somebody sweeps the
    // low-pass down: a resonant peak parked on the sub, which is a boom nobody asked for.
    const lerps = g.nodes.filter((n) => n.type === "lerp");
    const qRamps = lerps.filter(
      (n) => n.in?.[0] === Q_REST && n.in?.[1] === Q_MAX,
    );
    expect(qRamps).toHaveLength(2);
    expect(qRamps[0].in?.[2]).not.toBe(qRamps[1].in?.[2]);
  });

  it("stacks TWO stages a side, with only the second resonant", () => {
    // 24 dB/octave rather than 12: one pole pair muffles, two is the wall a DJ filter puts up.
    // Two RESONANT stages at one frequency would multiply their peaks — a filter that screams
    // before it sweeps — so the first of each pair stays flat.
    expect(biquads.map((n) => n.mode)).toEqual([
      "lowpass",
      "lowpass",
      "highpass",
      "highpass",
    ]);
    expect(biquads[0].in?.at(-1)).toBe(Q_REST);
    expect(biquads[1].in?.at(-1)).not.toBe(Q_REST);
    expect(biquads[2].in?.at(-1)).toBe(Q_REST);
    expect(biquads[3].in?.at(-1)).not.toBe(Q_REST);
    // Each pair shares one corner: two stages at different frequencies is not a slope.
    expect(biquads[0].in?.[0]).toBe(biquads[1].in?.[0]);
    expect(biquads[2].in?.[0]).toBe(biquads[3].in?.[0]);
  });

  it("takes back a LITTLE of the level the peak adds, and no more", () => {
    // The first attempt took −6 dB here and ate the peak exactly where the peak is the point:
    // +1.2 dB left at the corner, measured. And the clipping it guarded against was
    // theoretical — the filter removes 14 dB from the whole signal at that setting. What is
    // left keeps a Q of 6 sitting on a 30 Hz kick from costing somebody their master.
    expect(SWEEP_TRIM).toBeGreaterThanOrEqual(0.7);
    expect(SWEEP_TRIM).toBeLessThan(1);
    const trim = g.nodes.filter((n) => n.type === "gain");
    expect(trim).toHaveLength(1);
    // LAST, so it takes back what the stages above just added.
    expect(g.nodes.at(-1)?.type).toBe("gain");
  });

  it("puts both corners OUTSIDE the material at rest", () => {
    // The centre has to be silent, and it is silent by geometry rather than by a bypass:
    // 20 kHz is above anything in a song and 20 Hz below it. A module that had to be removed
    // to be silent is one a chain could not automate from nothing.
    expect(LOW_SWEEP.open).toBeGreaterThanOrEqual(20000);
    expect(HIGH_SWEEP.open).toBeLessThanOrEqual(20);
    expect(LOW_SWEEP.closed).toBeLessThan(LOW_SWEEP.open);
    expect(HIGH_SWEEP.closed).toBeGreaterThan(HIGH_SWEEP.open);
  });

  it("closes far enough to take the track AWAY", () => {
    // A filter that stopped a few hundred hertz down leaves a muddy thump. The last part of
    // the sweep — where only the peak is left whistling — is the part people actually use.
    expect(LOW_SWEEP.closed).toBeLessThanOrEqual(40);
    expect(HIGH_SWEEP.closed).toBeGreaterThanOrEqual(8000);
  });

  it("writes the descending half as an ASCENDING pair with an inverted journey", () => {
    // The engine sorts a geolerp's ends, so `geolerp(20000, 30, down)` reads as its own mirror
    // — the filter sat at 30 Hz with the knob at neutral, which is silence. The builder refuses
    // that spelling now; this pins the shape that replaced it, since a graph could be rewritten
    // to pass the guard and still sweep backwards.
    const geo = g.nodes.filter((n) => n.type === "geolerp");
    for (const n of geo) {
      const [lo, hi] = n.in as [number, number];
      expect(lo).toBeLessThan(hi);
    }
    // …and the low half's journey is 1 − down rather than down.
    const inverted = g.nodes.find((n) => n.type === "sub" && n.in?.[0] === 1);
    expect(inverted).toBeDefined();
    const lowGeo = geo.find((n) => n.in?.[0] === LOW_SWEEP.closed);
    expect(lowGeo?.in?.[2]).toBe(inverted?.out);
  });

  it("smooths both corners, because this is a knob people THROW", () => {
    // A biquad recomputes its coefficients per block. Without this a fast sweep is a stream of
    // coefficient jumps — a zipper, which reads as a broken filter rather than a quick one.
    expect(g.nodes.filter((n) => n.type === "glide")).toHaveLength(2);
  });
});
