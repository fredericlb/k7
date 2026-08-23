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
    // A desk control drives at most one param, and it is signed so neutral is mid-travel.
    expect(g.params.map((p) => p.name)).toEqual(["Sweep"]);
    const p = g.params[0];
    expect(p.min).toBe(SWEEP_RANGE.min);
    expect(p.max).toBe(SWEEP_RANGE.max);
    expect(p.default).toBe(0);
    expect(-p.min).toBe(p.max);
  });

  it("RESONATES, which is the whole difference from a tone control", () => {
    // 6 is measured, not chosen: at half sweep it gives +3.9 dB at the corner — ../docs/sweep.md.
    expect(Q_MAX).toBeGreaterThanOrEqual(6);

    // …and it is EARNED, not permanent: at rest the response is Butterworth, so it colours nothing.
    expect(Q_REST).toBeCloseTo(0.707, 3);
    expect(
      g.nodes.filter((n) => n.type === "lerp").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("gives each half its OWN resonance", () => {
    // Sharing one would park a resonant peak on the sub while somebody sweeps the low-pass down.
    const lerps = g.nodes.filter((n) => n.type === "lerp");
    const qRamps = lerps.filter(
      (n) => n.in?.[0] === Q_REST && n.in?.[1] === Q_MAX,
    );
    expect(qRamps).toHaveLength(2);
    expect(qRamps[0].in?.[2]).not.toBe(qRamps[1].in?.[2]);
  });

  it("stacks TWO stages a side, with only the second resonant", () => {
    // 24 dB/octave, and only the second of each pair resonates — Q² screams; ../docs/sweep.md.
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
    // The first attempt took −6 dB and ate the peak: +1.2 dB left at the corner, measured.
    expect(SWEEP_TRIM).toBeGreaterThanOrEqual(0.7);
    expect(SWEEP_TRIM).toBeLessThan(1);
    const trim = g.nodes.filter((n) => n.type === "gain");
    expect(trim).toHaveLength(1);
    // LAST, so it takes back what the stages above just added.
    expect(g.nodes.at(-1)?.type).toBe("gain");
  });

  it("puts both corners OUTSIDE the material at rest", () => {
    // The centre is silent by GEOMETRY rather than by a bypass, which this vocabulary has none of.
    expect(LOW_SWEEP.open).toBeGreaterThanOrEqual(20000);
    expect(HIGH_SWEEP.open).toBeLessThanOrEqual(20);
    expect(LOW_SWEEP.closed).toBeLessThan(LOW_SWEEP.open);
    expect(HIGH_SWEEP.closed).toBeGreaterThan(HIGH_SWEEP.open);
  });

  it("closes far enough to take the track AWAY", () => {
    // A filter that stopped a few hundred hertz down leaves a muddy thump instead of removing it.
    expect(LOW_SWEEP.closed).toBeLessThanOrEqual(40);
    expect(HIGH_SWEEP.closed).toBeGreaterThanOrEqual(8000);
  });

  it("writes the descending half as an ASCENDING pair with an inverted journey", () => {
    // A graph can pass the builder's guard and still sweep backwards, so pin the shape too.
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
    // A biquad recomputes per block, so without this a fast sweep is a stream of coefficient jumps.
    expect(g.nodes.filter((n) => n.type === "glide")).toHaveLength(2);
  });
});
