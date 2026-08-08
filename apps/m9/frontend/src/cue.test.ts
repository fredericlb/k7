// A cue point is a place in the FILE; `seek` takes a place on the TIMELINE. Everything below
// is that one conversion, which is invisible until somebody has stretched a deck — and then
// every cue on it is wrong, quietly and only on that deck.

import { describe, expect, it } from "vitest";
import { CUE_COLOURS, type DeckTempo, sourceAt, transportAt } from "./deck";

const at = (natural: number, target: number, align?: number): DeckTempo => ({
  natural,
  seconds: 300,
  target,
  ...(align === undefined ? {} : { align }),
});

describe("where a cue lands on the transport", () => {
  it("is the same number when nothing is stretched", () => {
    expect(transportAt(48, at(120, 120))).toBeCloseTo(48);
    expect(sourceAt(48, at(120, 120))).toBeCloseTo(48);
  });

  it("moves EARLIER on a deck that has been sped up", () => {
    // The whole point. A song of 120 played at 150 runs at 0.8× its own clock, so its 60 s
    // mark arrives at 48 s. A cue stored as "48 s on the transport" would be the drop today
    // and a bar early tomorrow.
    expect(transportAt(60, at(120, 150))).toBeCloseTo(48);
    expect(sourceAt(48, at(120, 150))).toBeCloseTo(60);
  });

  it("moves LATER on a deck that has been slowed down", () => {
    expect(transportAt(60, at(120, 96))).toBeCloseTo(75);
    expect(sourceAt(75, at(120, 96))).toBeCloseTo(60);
  });

  it("carries sync's alignment with it", () => {
    // The clip itself is delayed to meet the other deck. A cue that ignored that would be off
    // by the alignment on exactly the deck somebody has just beat-matched — the one they are
    // about to drop.
    const t = at(120, 120, 1); // one document beat at 120 bpm = 0.5 s
    expect(transportAt(60, t)).toBeCloseTo(60.5);
    expect(sourceAt(60.5, t)).toBeCloseTo(60);
  });

  it("round-trips, which is what dropping a cue and pressing it needs", () => {
    for (const tempo of [at(120, 150), at(90, 128, 0.8), at(174, 174)])
      for (const s of [0, 12.5, 137.25])
        expect(sourceAt(transportAt(s, tempo), tempo)).toBeCloseTo(s, 6);
  });

  it("passes the number through when the song has no tempo yet", () => {
    // The seconds between the load and the analysis landing. Inventing a ratio there would
    // place a cue by a number nobody measured.
    expect(transportAt(30, undefined)).toBeCloseTo(30);
    expect(transportAt(30, at(0, 0))).toBeCloseTo(30);
    expect(sourceAt(30, undefined)).toBeCloseTo(30);
  });

  it("never answers before the start of the file", () => {
    // A deck aligned late can put the transport BEFORE its own clip. Negative is not a place
    // in a file, and `seek` would clamp it anyway — saying 0 is the honest version.
    expect(sourceAt(0, at(120, 120, 4))).toBe(0);
  });
});

describe("the cue colours", () => {
  it("has one per button, and no two alike", () => {
    // A hot cue works because your hand knows where it is without reading. Two slots wearing
    // one colour would undo exactly that.
    expect(CUE_COLOURS).toHaveLength(8);
    expect(new Set(CUE_COLOURS).size).toBe(8);
  });
});
