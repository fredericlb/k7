import { describe, expect, it } from "vitest";
import { alignDelay, beatPhase, firstBeatAfter, NO_GRID } from "./beats";

/** Onsets on a grid of `bpm` starting at `phase`, with `jitter` seconds of slop. */
const onsets = (bpm: number, phase: number, n = 64, jitter = 0): number[] => {
  const p = 60 / bpm;
  // Deterministic slop: a fixed sawtooth, so a failure is reproducible.
  return Array.from(
    { length: n },
    (_, i) => phase + i * p + ((i % 5) - 2) * jitter,
  );
};

describe("where a song's beat grid starts", () => {
  it("finds the phase from onsets that sit on it", () => {
    const g = beatPhase(onsets(120, 0.2), 120);
    expect(g.phase).toBeCloseTo(0.2, 3);
    expect(g.strength).toBeGreaterThan(0.99);
  });

  it("survives a slop the first onset would not", () => {
    // Why this is an average and not `transients[0]`: here the first onset is a quarter beat early.
    const t = onsets(120, 0.2, 64, 0.01);
    t[0] = 0.075;
    const g = beatPhase(t, 120);
    expect(g.phase).toBeCloseTo(0.2, 1);
    expect(g.phase).not.toBeCloseTo(0.075, 2);
  });

  it("reports NO confidence when the onsets say nothing", () => {
    // Onsets spread evenly across the beat cancel out, and a confident answer from noise moves a record.
    const p = 60 / 120;
    const t = Array.from({ length: 60 }, (_, i) => (i * p) / 60);
    expect(beatPhase(t, 120).strength).toBeLessThan(0.1);
  });

  it("always lands inside one beat, and never behind zero", () => {
    // `atan2` answers in (-π, π], and a clip `start` cannot be less than zero.
    for (const phase of [0.01, 0.25, 0.3, 0.49]) {
      const g = beatPhase(onsets(120, phase), 120);
      expect(g.phase).toBeGreaterThanOrEqual(0);
      expect(g.phase).toBeLessThan(0.5);
      expect(g.phase).toBeCloseTo(phase, 3);
    }
  });

  it("folds a grid stated beyond one beat back into one", () => {
    // 0.6 s at 120 bpm IS 0.1 s into the next beat — the same grid, inside `[0, period)`.
    expect(beatPhase(onsets(120, 0.6), 120).phase).toBeCloseTo(0.1, 3);
  });

  it("has nothing to say without a tempo or without onsets", () => {
    expect(beatPhase([1, 2, 3], 0)).toEqual(NO_GRID);
    expect(beatPhase([], 120)).toEqual(NO_GRID);
  });

  it("calls a grid confident only when the onsets beat chance", () => {
    // `strength` alone would grade a song by its LENGTH, so the Rayleigh test decides — ../docs/bpm.md.
    expect(beatPhase(onsets(120, 0.2), 120).confident).toBe(true);
    const p = 60 / 120;
    // Golden-ratio steps: equidistributed round the beat, and deterministic.
    const scattered = Array.from(
      { length: 292 },
      (_, i) => (i * 0.618033988749 * p) % p,
    );
    const g = beatPhase(scattered, 120);
    expect(g.strength).toBeLessThan(0.2);
    expect(g.confident).toBe(false);
  });
});

describe("the first beat at or after a moment", () => {
  it("counts from the phase, forwards and backwards", () => {
    expect(firstBeatAfter(0, 0.2, 0.5)).toBeCloseTo(0.2);
    expect(firstBeatAfter(0.2, 0.2, 0.5)).toBeCloseTo(0.2);
    expect(firstBeatAfter(0.3, 0.2, 0.5)).toBeCloseTo(0.7);
    // Before the phase, the grid still extends back through the lead-in.
    expect(firstBeatAfter(-1, 0.2, 0.5)).toBeCloseTo(-0.8);
  });
});

describe("how far the slave moves to meet the master", () => {
  const at = (natural: number, target: number, phase: number) => ({
    natural,
    target,
    phase,
  });

  it("is nothing when the two grids already coincide", () => {
    const m = at(120, 120, 0.2);
    expect(alignDelay(m, { ...m }, 120)).toBeCloseTo(0);
  });

  it("delays by the gap between the two grids", () => {
    // A grid 0.1 s later than the master's waits 0.4 s for the NEXT beat, not 0.1 s backwards.
    const d = alignDelay(at(120, 120, 0.2), at(120, 120, 0.3), 120);
    // 0.4 s at the document's 120 bpm is 0.8 beats.
    expect(d).toBeCloseTo(0.8, 6);
  });

  it("never asks for more than a beat, or for a negative start", () => {
    for (const phase of [0, 0.1, 0.25, 0.4, 0.49]) {
      const d = alignDelay(at(120, 120, 0.2), at(120, 120, phase), 120);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1); // one beat of the document
    }
  });

  it("measures the phase where it is HEARD, not where it sits in the file", () => {
    // A grid 0.4 s into a 90 bpm FILE stretched to 120 arrives at 0.3 s — the file's number flams.
    const master = at(120, 120, 0);
    const slave = at(90, 120, 0.4);
    const period = 60 / 120;
    const heard = (0.4 * 90) / 120; // 0.3 s
    expect(alignDelay(master, slave, 120)).toBeCloseTo(
      ((period - heard) * 120) / 60,
      6,
    );
  });

  it("returns nothing for a deck with no tempo to play at", () => {
    expect(alignDelay(at(120, 120, 0.2), at(120, 0, 0.3), 120)).toBe(0);
    expect(alignDelay(at(120, 120, 0.2), at(120, 120, 0.3), 0)).toBe(0);
  });
});
