// A MIDI take's live window, and which notes belong to it once the count-in is over.

import { describe, expect, it } from "vitest";
import { beatWindow, keyRange } from "./components/MidiTakeRoll";
import { inTake } from "./hooks/useMidiRecording";

describe("the notes of a take", () => {
  it("leave out the count-in and pull an early downbeat onto the first beat", () => {
    const notes = [
      { t: 2, d: 1, k: 60, v: 1 }, // during the count-in
      { t: 7.9, d: 1, k: 62, v: 1 }, // a hair before the take's first beat
      { t: 9, d: 1, k: 64, v: 1 },
    ];
    expect(inTake(notes, 8)).toEqual([
      { t: 8, d: 0.9000000000000004, k: 62, v: 1 },
      { t: 9, d: 1, k: 64, v: 1 },
    ]);
  });
});

describe("the live roll's view", () => {
  it("spans two octaves around what was played, C3..C5 before anything", () => {
    expect(keyRange([])).toEqual({ lo: 48, hi: 72 });
    const r = keyRange([{ t: 0, d: 1, k: 60, v: 1 }]);
    expect(r.hi - r.lo).toBeGreaterThanOrEqual(24);
    expect(r.lo).toBeLessThan(60);
    expect(r.hi).toBeGreaterThan(60);
  });

  it("starts on the take and slides once the playhead nears its right edge", () => {
    expect(beatWindow(16, 17, 4)).toEqual({ lo: 16, hi: 48 });
    const late = beatWindow(16, 50, 4);
    expect(late.hi).toBeGreaterThan(50);
    expect(late.hi - late.lo).toBe(32);
  });
});
