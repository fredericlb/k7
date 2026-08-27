// What a MIDI cable carries at an instant. The peak is the interesting half: it is what the
// ripple is normalised against, so getting it wrong makes a whole part wobble at the wrong size
// rather than making one moment wrong.

import { describe, expect, it } from "vitest";
import { laneNotes, type NoteSpan, noteLoadAt, peakLoad } from "./noteLoad";

const n = (from: number, to: number, vel: number): NoteSpan => ({
  from,
  to,
  vel,
});

describe("what is sounding", () => {
  const chord = [n(0, 2, 1), n(0, 1, 0.5), n(4, 5, 0.25)];

  it("sums the velocities of every note over that instant", () => {
    expect(noteLoadAt(chord, 0.5)).toBe(1.5);
  });

  it("is half-open: a note ends AT its `to`", () => {
    expect(noteLoadAt(chord, 1)).toBe(1); // the 0.5 has stopped, the 1 has not
    expect(noteLoadAt(chord, 2)).toBe(0);
  });

  it("is silent in the gap between two notes", () => {
    expect(noteLoadAt(chord, 3)).toBe(0);
  });
});

describe("the peak", () => {
  it("is the busiest instant, not the loudest note", () => {
    // Three notes overlapping at 0.5 is a bigger load than any one of them.
    expect(
      peakLoad([n(0, 1, 0.4), n(0.2, 1, 0.4), n(0.4, 1, 0.4)]),
    ).toBeCloseTo(1.2, 6);
  });

  it("catches a chord shorter than any sampling step would be", () => {
    // The reason it sweeps note STARTS rather than sampling the timeline: this chord lasts a
    // millisecond, and a sampler stepping even 10 ms would report the peak as one note.
    expect(peakLoad([n(9, 9.001, 1), n(9, 9.001, 1)])).toBe(2);
  });

  it("is zero for a lane with no notes", () => {
    expect(peakLoad([])).toBe(0);
  });
});

describe("laneNotes", () => {
  it("carries each lane's peak beside its notes, computed once", () => {
    const out = laneNotes({ melody: [n(0, 1, 0.5), n(0, 1, 0.5)] });
    expect(out.melody.peak).toBe(1);
    expect(out.melody.spans).toHaveLength(2);
  });

  it("leaves out a lane with nothing on it, as videoSpans leaves one out", () => {
    expect(laneNotes({ empty: [] })).toEqual({});
  });
});
