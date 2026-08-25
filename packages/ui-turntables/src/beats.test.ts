import { describe, expect, it } from "vitest";
import { alignSeek, beatPhase, firstBeatAfter, NO_GRID } from "./beats";

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
    // `atan2` answers in (-π, π], and a needle cannot land behind the start of a record.
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

describe("aligning two PLATTERS, which share no start", () => {
  /** Where a deck's beat falls, as a fraction of one — the thing that must come out equal. */
  const phaseOf = (d: { natural: number; phase: number }, needle: number) => {
    const b = ((needle - d.phase) * d.natural) / 60;
    return ((b % 1) + 1) % 1;
  };

  it("puts the slave's beat ON the master's, wherever the two happen to be", () => {
    const master = { natural: 120, phase: 0.2 };
    const slave = { natural: 90, phase: 0.7 };
    for (const [a, b] of [
      [61.3, 12.9],
      [4.05, 180.4],
      [0.9, 0.1],
    ]) {
      const moved = alignSeek(master, slave, { master: a, slave: b });
      expect(moved).not.toBeNull();
      expect(phaseOf(slave, moved as number)).toBeCloseTo(
        phaseOf(master, a),
        6,
      );
    }
  });

  it("takes the SHORTER way — never more than half a beat, where a clip's delay is never negative", () => {
    const master = { natural: 120, phase: 0 };
    const slave = { natural: 120, phase: 0 };
    // The slave is a hair AHEAD: pulling it back a hair beats delaying it almost a whole beat.
    const moved = alignSeek(master, slave, { master: 10, slave: 10.05 });
    expect(moved).toBeCloseTo(10, 6);
  });

  it("never lands before the record starts", () => {
    const master = { natural: 120, phase: 0 };
    const slave = { natural: 120, phase: 0 };
    const moved = alignSeek(master, slave, { master: 10, slave: 0.05 });
    expect(moved as number).toBeGreaterThanOrEqual(0);
  });

  it("says NOTHING rather than invent a phase", () => {
    const ok = { natural: 120, phase: 0 };
    expect(alignSeek(ok, { natural: 120 }, { master: 1, slave: 1 })).toBeNull();
    expect(alignSeek({ natural: 120 }, ok, { master: 1, slave: 1 })).toBeNull();
    expect(
      alignSeek(ok, { natural: 0, phase: 0 }, { master: 1, slave: 1 }),
    ).toBeNull();
  });
});
