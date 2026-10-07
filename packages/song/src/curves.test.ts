import { describe, expect, it } from "vitest";
import { bakeCurve, type Curve, parseCurve, sampleCurve } from "./curves";

// 4/4 throughout: a bar is 4 quarter-note beats.
const NUM = 4;
const DEN = 4;

describe("parseCurve", () => {
  it("reads an lfo with defaults (sine shape)", () => {
    expect(parseCurve("x", { type: "lfo" })).toEqual({
      type: "lfo",
      polarity: "unipolar",
      amplitude: 1,
      shape: "sine",
      frequency: 1,
      phase: 0,
    });
  });

  it("reads a shape, falling back to sine on an unknown one", () => {
    expect((parseCurve("x", { type: "lfo", shape: "saw" }) as any).shape).toBe(
      "saw",
    );
    expect(
      (parseCurve("x", { type: "lfo", shape: "noise" }) as any).shape,
    ).toBe("sine");
  });

  it("reads a custom curve, clamping point values to 0..1", () => {
    const c = parseCurve("x", {
      type: "custom",
      polarity: "bipolar",
      points: [
        { time: "1:1:1", value: 0 },
        { time: "2:1:1", value: 1.5 },
      ],
    }) as Extract<Curve, { type: "custom" }>;
    expect(c.polarity).toBe("bipolar");
    expect(c.points).toEqual([
      { time: "1:1:1", value: 0 },
      { time: "2:1:1", value: 1 },
    ]);
  });

  it("rejects a bad shape", () => {
    expect(() => parseCurve("x", { type: "lfo", frequency: 0 })).toThrow(/> 0/);
    expect(() => parseCurve("x", { type: "custom", points: [] })).toThrow(
      /at least one/,
    );
    expect(() => parseCurve("x", { type: "square" })).toThrow(/unknown type/);
  });
});

describe("sampleCurve — lfo (cycles per bar)", () => {
  const lfo = (over: Partial<Extract<Curve, { type: "lfo" }>> = {}): Curve => ({
    type: "lfo",
    polarity: "unipolar",
    amplitude: 1,
    shape: "sine",
    frequency: 1,
    phase: 0,
    ...over,
  });

  it("unipolar sine sits in 0..1, centred at 0.5 at the origin", () => {
    // sin(0) lifted -> 0.5
    expect(sampleCurve(lfo(), 0, NUM, DEN)).toBeCloseTo(0.5);
    // quarter of a bar (1 beat) into a 1-cycle/bar LFO -> peak (sin(π/2)) -> 1
    expect(sampleCurve(lfo(), 1, NUM, DEN)).toBeCloseTo(1);
    // half a bar -> back to 0.5; three-quarters -> trough -> 0
    expect(sampleCurve(lfo(), 2, NUM, DEN)).toBeCloseTo(0.5);
    expect(sampleCurve(lfo(), 3, NUM, DEN)).toBeCloseTo(0);
  });

  it("bipolar swings -1..1", () => {
    expect(sampleCurve(lfo({ polarity: "bipolar" }), 0, NUM, DEN)).toBeCloseTo(
      0,
    );
    expect(sampleCurve(lfo({ polarity: "bipolar" }), 1, NUM, DEN)).toBeCloseTo(
      1,
    );
    expect(sampleCurve(lfo({ polarity: "bipolar" }), 3, NUM, DEN)).toBeCloseTo(
      -1,
    );
  });

  it("frequency is per BAR: 0.5 cycle/bar spans two bars", () => {
    // Half a cycle per bar: the peak is at beat 2, and beat 4 is the half-cycle zero-cross.
    expect(sampleCurve(lfo({ frequency: 0.5 }), 2, NUM, DEN)).toBeCloseTo(1);
    expect(sampleCurve(lfo({ frequency: 0.5 }), 4, NUM, DEN)).toBeCloseTo(0.5);
  });

  it("phase offsets the start by a fraction of a cycle", () => {
    // phase 0.25 == a quarter-cycle head start, so the origin already reads the peak.
    expect(sampleCurve(lfo({ phase: 0.25 }), 0, NUM, DEN)).toBeCloseTo(1);
  });

  it("triangle: 0 → 1 → 0 across the bar, unipolar", () => {
    const t = lfo({ shape: "triangle" }); // 1 cycle/bar, bar = 4 beats
    expect(sampleCurve(t, 0, NUM, DEN)).toBeCloseTo(0); // cycle start
    expect(sampleCurve(t, 2, NUM, DEN)).toBeCloseTo(1); // mid-cycle peak
    expect(sampleCurve(t, 4, NUM, DEN)).toBeCloseTo(0); // cycle end
    expect(sampleCurve(t, 1, NUM, DEN)).toBeCloseTo(0.5); // quarter up
  });

  it("saw: a rising ramp 0 → 1 within the cycle", () => {
    const s = lfo({ shape: "saw" });
    expect(sampleCurve(s, 0, NUM, DEN)).toBeCloseTo(0);
    expect(sampleCurve(s, 2, NUM, DEN)).toBeCloseTo(0.5);
    expect(sampleCurve(s, 3, NUM, DEN)).toBeCloseTo(0.75);
  });

  it("square: high for the first half of the cycle, low for the second", () => {
    const q = lfo({ shape: "square" });
    expect(sampleCurve(q, 0, NUM, DEN)).toBe(1); // first half
    expect(sampleCurve(q, 1, NUM, DEN)).toBe(1);
    expect(sampleCurve(q, 2, NUM, DEN)).toBe(0); // second half
    expect(sampleCurve(q, 3, NUM, DEN)).toBe(0);
    // bipolar square swings to the rails
    expect(
      sampleCurve(lfo({ shape: "square", polarity: "bipolar" }), 0, NUM, DEN),
    ).toBe(1);
    expect(
      sampleCurve(lfo({ shape: "square", polarity: "bipolar" }), 2, NUM, DEN),
    ).toBe(-1);
  });
});

describe("sampleCurve — custom (linear, held at the ends)", () => {
  const ramp: Curve = {
    type: "custom",
    polarity: "unipolar",
    amplitude: 1,
    points: [
      { time: "1:1:1", value: 0 }, // beat 0
      { time: "2:1:1", value: 1 }, // beat 4 (bar 2)
    ],
  };

  it("interpolates linearly between points", () => {
    expect(sampleCurve(ramp, 0, NUM, DEN)).toBeCloseTo(0);
    expect(sampleCurve(ramp, 2, NUM, DEN)).toBeCloseTo(0.5); // halfway
    expect(sampleCurve(ramp, 4, NUM, DEN)).toBeCloseTo(1);
  });

  it("holds flat before the first and after the last point", () => {
    expect(sampleCurve(ramp, -10, NUM, DEN)).toBeCloseTo(0);
    expect(sampleCurve(ramp, 100, NUM, DEN)).toBeCloseTo(1);
  });

  it("bipolar remaps the authored 0..1 onto -1..1", () => {
    const bip: Curve = { ...ramp, polarity: "bipolar" };
    expect(sampleCurve(bip, 0, NUM, DEN)).toBeCloseTo(-1);
    expect(sampleCurve(bip, 2, NUM, DEN)).toBeCloseTo(0);
    expect(sampleCurve(bip, 4, NUM, DEN)).toBeCloseTo(1);
  });

  it("sorts out-of-order points before reading", () => {
    const unsorted: Curve = {
      type: "custom",
      polarity: "unipolar",
      amplitude: 1,
      points: [
        { time: "2:1:1", value: 1 },
        { time: "1:1:1", value: 0 },
      ],
    };
    expect(sampleCurve(unsorted, 2, NUM, DEN)).toBeCloseTo(0.5);
  });
});

describe("bakeCurve", () => {
  it("emits a custom curve's authored points verbatim (beat, output)", () => {
    const c: Curve = {
      type: "custom",
      polarity: "unipolar",
      amplitude: 1,
      points: [
        { time: "1:1:1", value: 0 }, // beat 0
        { time: "3:1:1", value: 1 }, // beat 8
      ],
    };
    const b = bakeCurve(c, NUM, DEN, 100);
    expect(b.bipolar).toBe(false);
    expect(b.points).toEqual([
      [0, 0],
      [8, 1],
    ]);
  });

  it("carries polarity so the engine can map the output range", () => {
    const c: Curve = {
      type: "lfo",
      polarity: "bipolar",
      amplitude: 1,
      shape: "sine",
      frequency: 1,
      phase: 0,
    };
    expect(bakeCurve(c, NUM, DEN, 8).bipolar).toBe(true);
  });

  it("samples an LFO on a grid over the song, output within the polarity range", () => {
    const c: Curve = {
      type: "lfo",
      polarity: "unipolar",
      amplitude: 1,
      shape: "triangle",
      frequency: 1,
      phase: 0,
    };
    const b = bakeCurve(c, NUM, DEN, 16); // 4 bars
    expect(b.points.length).toBeGreaterThan(16); // dense sampling
    expect(b.points[0]).toEqual([0, 0]); // triangle starts at 0
    for (const [, v] of b.points)
      expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    // Covers at least the song length.
    expect(b.points[b.points.length - 1][0]).toBeGreaterThanOrEqual(16);
  });
});

describe("amplitude", () => {
  const sq = (polarity: "unipolar" | "bipolar") =>
    parseCurve("x", { type: "lfo", shape: "square", polarity, amplitude: 0.5 });

  it("scales a unipolar curve's top, 0..amplitude", () => {
    expect(sampleCurve(sq("unipolar"), 0, NUM, DEN)).toBe(0.5);
    expect(sampleCurve(sq("unipolar"), 2, NUM, DEN)).toBe(0);
  });

  it("scales a bipolar curve around 0, -amplitude..amplitude", () => {
    expect(sampleCurve(sq("bipolar"), 0, NUM, DEN)).toBe(0.5);
    expect(sampleCurve(sq("bipolar"), 2, NUM, DEN)).toBe(-0.5);
  });

  it("clamps an amplitude past the range, and reads none as the whole range", () => {
    expect(parseCurve("x", { type: "lfo", amplitude: 3 }).amplitude).toBe(1);
    expect(
      parseCurve("x", { type: "custom", points: [{ time: "1:1", value: 1 }] })
        .amplitude,
    ).toBe(1);
  });
});
