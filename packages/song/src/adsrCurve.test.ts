// The ADSR curve: a shape in MILLISECONDS, laid down wherever an event fires it. What is pinned
// here is the shape itself and what happens when two triggers overlap — the case a keyboard
// answers with a second voice and a single automation lane cannot.

import { describe, expect, it } from "vitest";
import { type AdsrCurve, adsrUnit, bakeAdsr, parseCurve } from "./curves";

/** 100ms attack, 100ms decay to 0.5, 200ms hold, 100ms release. Half a second in all. */
const env = (over: Partial<AdsrCurve> = {}): AdsrCurve => ({
  type: "adsr",
  polarity: "unipolar",
  attack: 100,
  decay: 100,
  sustain: 200,
  release: 100,
  level: 0.5,
  ...over,
});

// 120 BPM: a beat is 500ms, so the whole envelope above is exactly one beat.
const TEMPO = 120;

describe("the shape, as a function of time since the trigger", () => {
  it("rises, falls to the level, holds it, then leaves", () => {
    const e = env();
    expect(adsrUnit(e, 0)).toBe(0);
    expect(adsrUnit(e, 50)).toBeCloseTo(0.5); // half way up
    expect(adsrUnit(e, 100)).toBeCloseTo(1); // the peak
    expect(adsrUnit(e, 150)).toBeCloseTo(0.75); // half way down to the level
    expect(adsrUnit(e, 200)).toBeCloseTo(0.5); // at the level
    expect(adsrUnit(e, 350)).toBeCloseTo(0.5); // still holding
    expect(adsrUnit(e, 450)).toBeCloseTo(0.25); // half way out
    expect(adsrUnit(e, 500)).toBe(0);
  });

  it("is silent once it is over, and before it starts", () => {
    expect(adsrUnit(env(), 5000)).toBe(0);
    expect(adsrUnit(env(), -1)).toBe(0);
  });

  it("survives a stage of zero, rather than dividing by it", () => {
    // An instant attack is a real thing to ask for, and 0/0 is not a value.
    const snap = env({ attack: 0, decay: 0 });
    expect(Number.isFinite(adsrUnit(snap, 0))).toBe(true);
    expect(adsrUnit(snap, 1)).toBeCloseTo(0.5); // straight to the level
  });
});

describe("laying it down at the triggers", () => {
  it("puts the five corners at one trigger, in beats", () => {
    // 120 BPM: 100ms is a fifth of a beat.
    const { points } = bakeAdsr(env(), [4], TEMPO);
    expect(points).toEqual([
      [4, 0],
      [4.2, 1],
      [4.4, 0.5],
      [4.8, 0.5],
      [5, 0],
    ]);
  });

  it("repeats it at every trigger", () => {
    const { points } = bakeAdsr(env(), [0, 2], TEMPO);
    expect(points[0]).toEqual([0, 0]);
    expect(points.find((p) => p[0] === 2)).toEqual([2, 0]); // the second starts from zero
    expect(points.filter((p) => p[1] === 1)).toHaveLength(2); // two peaks
  });

  it("holds a running envelope at the value it REACHED, mid-ramp", () => {
    // Without a point at the cut the line runs from the peak down, losing the decay's own slope.
    const { points } = bakeAdsr(env(), [0, 0.3], TEMPO);
    const before = points.filter((p) => p[0] < 0.3);
    expect(before.at(-1)?.[1]).toBeCloseTo(0.75);
    expect(before.at(-1)?.[0]).toBeCloseTo(0.3, 4);
  });

  it("CUTS a running envelope where the next trigger lands", () => {
    // One lane holds one value, so the second trigger stops the first before its release.
    const { points } = bakeAdsr(env(), [0, 0.5], TEMPO);
    const cut = points.filter((p) => p[0] < 0.5);
    expect(cut.at(-1)?.[1]).toBeCloseTo(0.5); // held at the level it had reached
    expect(points.find((p) => p[0] === 0.5)).toEqual([0.5, 0]); // …then straight back to zero
    // …and past the cut only the SECOND envelope's five corners, offset by half a beat.
    expect(points.filter((p) => p[0] >= 0.5)).toEqual([
      [0.5, 0],
      [0.7, 1],
      [0.9, 0.5],
      [1.3, 0.5],
      [1.5, 0],
    ]);
  });

  it("takes the triggers in any order", () => {
    expect(bakeAdsr(env(), [2, 0], TEMPO)).toEqual(
      bakeAdsr(env(), [0, 2], TEMPO),
    );
  });

  it("answers an empty trigger list with an empty curve, not a flat line", () => {
    // Nothing fired it, so it says nothing — and a lane with no points leaves the param alone.
    expect(bakeAdsr(env(), [], TEMPO).points).toEqual([]);
  });

  it("is measured in MILLISECONDS, so the tempo moves it", () => {
    // 500ms is a beat at 120 and half a beat at 240, which is why the file is written in ms.
    const slow = bakeAdsr(env(), [0], 60).points.at(-1)![0];
    const fast = bakeAdsr(env(), [0], 240).points.at(-1)![0];
    expect(slow).toBeCloseTo(0.5);
    expect(fast).toBeCloseTo(2);
  });

  it("maps a bipolar envelope onto -1..1", () => {
    const { points, bipolar } = bakeAdsr(
      env({ polarity: "bipolar" }),
      [0],
      TEMPO,
    );
    expect(bipolar).toBe(true);
    expect(points[0]).toEqual([0, -1]); // silence is the bottom, not the middle
    expect(points[1]).toEqual([0.2, 1]);
  });
});

describe("reading one off the file", () => {
  it("takes the four durations and the level", () => {
    const c = parseCurve("env1", {
      type: "adsr",
      attack: 5,
      decay: 20,
      sustain: 300,
      release: 80,
      level: 0.8,
    }) as AdsrCurve;
    expect(c).toMatchObject({
      attack: 5,
      decay: 20,
      sustain: 300,
      release: 80,
      level: 0.8,
    });
  });

  it("defaults the level rather than leaving the envelope silent", () => {
    // A level of 0 is an envelope that looks authored and does not sound; a time of 0 is a spike.
    const c = parseCurve("env1", { type: "adsr" }) as AdsrCurve;
    expect(c.level).toBe(0.5);
    expect([c.attack, c.decay, c.sustain, c.release]).toEqual([0, 0, 0, 0]);
  });

  it("refuses a duration that is not one, by name", () => {
    expect(() => parseCurve("env1", { type: "adsr", decay: -5 })).toThrow(
      /adsr decay must be a duration in ms/,
    );
  });
});
