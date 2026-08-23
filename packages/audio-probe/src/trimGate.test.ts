import { describe, expect, it } from "vitest";
import { ampToDb, trimWindow } from "./trimGate";

// Where a take starts and stops SOUNDING, ten buckets over ten seconds — docs/trimGate.md.

const db = (v: number) => 10 ** (v / 20); // dBFS → linear amplitude
const LOUD = db(-6);
const QUIET = db(-60);

describe("finding the sound", () => {
  it("cuts the silence at both ends", () => {
    // Silence, sound in buckets 3..6, silence. With one bucket of margin each side: 2s → 8s.
    const env = [0, 0, 0, LOUD, LOUD, LOUD, LOUD, 0, 0, 0];
    expect(trimWindow(env, 10, -40)).toEqual({ from: 2, to: 8 });
  });

  it("keeps a bucket of margin, so the attack that crossed the gate is not clipped", () => {
    // Cutting exactly at the gate shaves the transient that crossed it — docs/trimGate.md.
    expect(trimWindow([0, LOUD, 0], 3, -40)).toEqual({ from: 0, to: 3 });
  });

  it("does not run past the file at either end", () => {
    const env = [LOUD, LOUD, LOUD];
    expect(trimWindow(env, 3, -40)).toEqual({ from: 0, to: 3 });
  });

  it("reads the gate in dBFS, not as an amplitude", () => {
    const env = [0, QUIET, 0, LOUD, 0];
    // −40 leaves the −60 bucket out…
    expect(trimWindow(env, 5, -40)).toEqual({ from: 2, to: 5 });
    // …and −70 takes it in, which is the same take with a lower gate.
    expect(trimWindow(env, 5, -70)).toEqual({ from: 0, to: 5 });
  });
});

describe("bounded to the clip's own window", () => {
  it("ignores sound OUTSIDE the interval — a re-trim never reaches back", () => {
    // Sound in buckets 1 and 8 lies outside a clip playing 3s → 7s; only bucket 5 counts.
    const env = [0, LOUD, 0, 0, 0, LOUD, 0, 0, LOUD, 0];
    expect(trimWindow(env, 10, -40, { from: 3, to: 7 })).toEqual({
      from: 4,
      to: 7,
    });
  });

  it("clamps the margin to the interval, not to the file", () => {
    // The one-bucket widening would land at 2s, before the clip's `from`; the cage holds it at 3s.
    const env = [0, 0, 0, LOUD, 0, 0, 0, 0, 0, 0];
    expect(trimWindow(env, 10, -40, { from: 3, to: 7 })).toEqual({
      from: 3,
      to: 5,
    });
  });

  it("counts a bucket the interval only touches", () => {
    // The interval ends mid-bucket 5; the sound there is still the clip's sound.
    const env = [0, 0, 0, 0, 0, LOUD, 0, 0, 0, 0];
    expect(trimWindow(env, 10, -40, { from: 3, to: 5.5 })).toEqual({
      from: 4,
      to: 5.5,
    });
  });

  it("answers null when the interval holds nothing above the gate", () => {
    // The take is loud elsewhere — but elsewhere is not this clip.
    const env = [LOUD, LOUD, 0, 0, 0, 0, 0, 0, LOUD, LOUD];
    expect(trimWindow(env, 10, -40, { from: 3, to: 7 })).toBe(null);
  });

  it("survives an interval the file outgrew, and one that runs backwards", () => {
    const env = [0, LOUD, 0];
    // A `to` past the audio clamps to the file…
    expect(trimWindow(env, 3, -40, { from: 0, to: 99 })).toEqual({
      from: 0,
      to: 3,
    });
    // …and a window of no length is nothing to look in.
    expect(trimWindow(env, 3, -40, { from: 2, to: 1 })).toBe(null);
  });
});

describe("when there is nothing to keep", () => {
  it("answers null rather than trimming to nothing", () => {
    // A take entirely below the gate is silence or a gate set too high — both are things to SAY.
    expect(trimWindow([0, 0, 0], 3, -40)).toBe(null);
    expect(trimWindow([QUIET, QUIET], 2, -40)).toBe(null);
  });

  it("answers null for an empty envelope or a file of no length", () => {
    expect(trimWindow([], 10, -40)).toBe(null);
    expect(trimWindow([LOUD], 0, -40)).toBe(null);
  });
});

describe("the dB scale", () => {
  it("puts a zero bucket at the floor rather than at minus infinity", () => {
    // Comparisons have to be TOTAL: `-Infinity > gate` is false, but so is `NaN`.
    expect(ampToDb(0)).toBe(-100);
    expect(ampToDb(1)).toBeCloseTo(0, 6);
    expect(ampToDb(db(-20))).toBeCloseTo(-20, 6);
  });
});
