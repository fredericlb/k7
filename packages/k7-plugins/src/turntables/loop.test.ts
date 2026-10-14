// The desk's half of a loop: a length in beats becoming two edges the platter can be sent.
// The engine's half — the wrap and the roll's shadow — is engine/k7-runtime/tests/TurntableLoop_test.cpp.
//
// What would be wrong silently here: a length measured against the FADER's tempo rather than the
// record's, which sounds right on a deck at rest and drifts the moment somebody pitches it.

import { describe, expect, it } from "vitest";
import type { DeckTempo } from "./deckVocabulary";
import {
  beatJump,
  beatSeconds,
  beatsBetween,
  canLoop,
  LOOP_MAX_BEATS,
  LOOP_MIN_BEATS,
  loopEdges,
  loopParams,
  resized,
  snapToBeat,
} from "./loop";
import { lengthLabel } from "./views/LoopRow";

/** 120 BPM — half a second a beat — with its first beat a tenth of a second in. */
const tempo: DeckTempo = {
  natural: 120,
  seconds: 200,
  target: 120,
  phase: 0.1,
};

describe("beatSeconds", () => {
  it("is the RECORD's beat and not the fader's", () => {
    // The whole point: a deck pulled to 174 still loops four beats of its own 120 BPM grid.
    expect(beatSeconds({ ...tempo, target: 174 })).toBe(0.5);
  });

  it("is 0 with nothing measured, which is what greys the buttons", () => {
    expect(beatSeconds(undefined)).toBe(0);
    expect(beatSeconds({ ...tempo, natural: 0 })).toBe(0);
  });
});

describe("canLoop", () => {
  it("wants a tempo AND a length — the edges are a fraction of the record", () => {
    expect(canLoop(tempo)).toBe(true);
    expect(canLoop({ ...tempo, natural: 0 })).toBe(false);
    expect(canLoop({ ...tempo, seconds: 0 })).toBe(false);
    expect(canLoop(undefined)).toBe(false);
  });
});

describe("snapToBeat", () => {
  it("goes to the NEAREST beat, backwards as readily as forwards", () => {
    // 12.34 sits just after the beat at 12.1; the next one is 12.6.
    expect(snapToBeat(12.34, tempo)).toBeCloseTo(12.1, 9);
    expect(snapToBeat(12.44, tempo)).toBeCloseTo(12.6, 9);
  });

  it("never lands before the record starts", () => {
    // The nearest beat to 0.02 is the grid's own −0.4, which is not a place a needle goes.
    expect(snapToBeat(0.02, tempo)).toBeGreaterThanOrEqual(0);
  });

  it("changes nothing on a record with no grid", () => {
    expect(snapToBeat(12.34, undefined)).toBe(12.34);
    expect(snapToBeat(12.34, { ...tempo, natural: 0 })).toBe(12.34);
  });
});

describe("resized", () => {
  it("halves and doubles, and stops at both ends", () => {
    expect(resized(8, 2)).toBe(16);
    expect(resized(8, 0.5)).toBe(4);
    expect(resized(LOOP_MAX_BEATS, 2)).toBe(LOOP_MAX_BEATS);
    expect(resized(LOOP_MIN_BEATS, 0.5)).toBe(LOOP_MIN_BEATS);
  });
});

describe("beatsBetween", () => {
  it("rounds a manual loop onto the grid", () => {
    expect(beatsBetween(10, 12, tempo)).toBe(4);
    // Three and a bit beats is three: a hand is late, and a loop off the grid is what this avoids.
    expect(beatsBetween(10, 11.6, tempo)).toBe(3);
  });

  it("drops onto the ÷2 ladder below one beat, rather than rounding to zero", () => {
    expect(beatsBetween(10, 10.2, tempo)).toBe(0.5);
    expect(beatsBetween(10, 10.05, tempo)).toBe(0.125);
  });

  it("stops at the long end", () => {
    expect(beatsBetween(0, 199, tempo)).toBe(LOOP_MAX_BEATS);
  });
});

describe("loopEdges", () => {
  it("is a FRACTION of the record, the units Seek already uses", () => {
    const at = loopEdges({ start: 10, beats: 4, roll: false }, tempo);
    // Four beats of a 120 grid is two seconds, out of two hundred.
    expect(at).toEqual({ start: 10 / 200, end: 12 / 200 });
  });

  it("clamps a loop that would run off the end", () => {
    const at = loopEdges({ start: 199, beats: 16, roll: false }, tempo);
    expect(at).toEqual({ start: 199 / 200, end: 1 });
  });

  it("refuses one with no room left, rather than sending a hang", () => {
    // The platter refuses a loop shorter than sixteen frames; this refuses it before the wire.
    expect(
      loopEdges({ start: 199.99, beats: 16, roll: false }, tempo),
    ).toBeNull();
    expect(
      loopEdges({ start: 10, beats: 4, roll: false }, undefined),
    ).toBeNull();
  });

  it("measures the length at the RECORD's tempo, not the fader's", () => {
    const pitched = { ...tempo, target: 174 };
    expect(loopEdges({ start: 10, beats: 4, roll: false }, pitched)).toEqual({
      start: 10 / 200,
      end: 12 / 200,
    });
  });
});

describe("beatJump", () => {
  it("moves by whole beats, either way", () => {
    expect(beatJump(10, 4, tempo, false)).toBeCloseTo(12, 9);
    expect(beatJump(10, -4, tempo, false)).toBeCloseTo(8, 9);
  });

  it("lands ON the grid when quantising, and where it fell when not", () => {
    expect(beatJump(10.31, 4, tempo, false)).toBeCloseTo(12.31, 9);
    expect(beatJump(10.31, 4, tempo, true)).toBeCloseTo(12.1, 9);
  });

  it("stays inside the record at both ends", () => {
    expect(beatJump(1, -16, tempo, false)).toBe(0);
    expect(beatJump(199, 16, tempo, false)).toBe(200);
  });

  it("does nothing at all without a grid", () => {
    expect(beatJump(10, 4, undefined, true)).toBe(10);
  });
});

// The ORDER on the wire, which is the one thing here a unit test can hold and a reader cannot see.
// Params arrive one at a time and the platter re-reads them every block, so a two-message change
// has an intermediate state — and one of the four possible orders moves the record.
describe("loopParams", () => {
  const edges = { start: 0.25, end: 0.3 };

  it("turns a loop off by moving the END alone", () => {
    // The trap: `LoopStart = 0` landing first would leave [0, 0.3] standing for one block — a loop
    // over the first third of the record, which the platter would pull the needle into.
    expect(loopParams(null, false)).toEqual([["LoopEnd", 0]]);
  });

  it("sends Roll BEFORE the edges, because the platter latches it at the engage", () => {
    expect(loopParams(edges, true)).toEqual([
      ["Roll", 1],
      ["LoopStart", 0.25],
      ["LoopEnd", 0.3],
    ]);
  });

  it("opens with the START first, so the pair is never briefly a loop nobody asked for", () => {
    // [newStart, oldEnd] with a start past the old end is `end < start`, which is OFF — inert.
    const [, first] = loopParams(edges, false);
    expect(first).toEqual(["LoopStart", 0.25]);
  });

  it("resizes with the END alone, which keeps the loop ENGAGED", () => {
    // A resize that disengaged would drop a roll's shadow, and ÷2 would jump the record back.
    expect(loopParams(edges, true, true)).toEqual([["LoopEnd", 0.3]]);
  });
});

// How a length reads once ÷2 has been past one — the row's own readout, ./views/LoopRow.tsx.
describe("lengthLabel", () => {
  it("writes a fraction rather than a decimal", () => {
    expect(lengthLabel(16)).toBe("16");
    expect(lengthLabel(1)).toBe("1");
    // `0.125` on a mixer means nothing; `1/8` is what the button under it does.
    expect(lengthLabel(0.5)).toBe("1/2");
    expect(lengthLabel(0.125)).toBe("1/8");
  });
});
