// The loop marks the roll and the waveform both draw. One arithmetic, two axes — and the axes
// have different origins, which is the whole reason this is a module and not two inline sums.

import { describe, expect, it } from "vitest";
import {
  clipLoop,
  placedRepeats,
  playedZone,
  visibleRepeats,
} from "./clipLoop";
import type { WebClip } from "./types";

const clip = (over: Partial<WebClip>): WebClip => ({
  id: "c",
  type: "midi",
  name: "c",
  start: 0,
  length: 0,
  notes: [],
  ...over,
});

describe("clipLoop", () => {
  it("says nothing when the clip states no loop", () => {
    expect(clipLoop(clip({}))).toBeNull();
    // Every ClipDoc carries the fields, so 0/0 is what "no loop" looks like on the wire.
    expect(clipLoop(clip({ loopStart: 0, loopEnd: 0 }))).toBeNull();
    // …and a window that does not run forwards is not one either.
    expect(clipLoop(clip({ loopStart: 8, loopEnd: 4 }))).toBeNull();
  });

  it("counts the passes a placed length is made of", () => {
    // Real numbers from LEMO - DANSE: an 8-beat drum window placed 80 beats long.
    const l = clipLoop(clip({ length: 80, loopStart: 0, loopEnd: 8 }));
    expect(l).toMatchObject({ from: 0, to: 8, win: 8, passes: 10 });
    expect(l?.repeats).toEqual([8, 16, 24, 32, 40, 48, 56, 64, 72]);
  });

  it("keeps a MIDI window where the notes put it", () => {
    // The roll draws note times, and loopStart/loopEnd are positions in those same notes — so a
    // window opening at bar 3 is drawn at bar 3, and the notes before it visibly do not play.
    const l = clipLoop(clip({ length: 8, loopStart: 8, loopEnd: 12 }));
    expect(l).toMatchObject({ from: 8, to: 12, win: 4, passes: 2 });
    expect(l?.repeats).toEqual([12]);
  });

  it("opens an AUDIO region at 0, whatever beats into the source the loop says", () => {
    // The waveform is drawn from the clip's in-point, and that in-point IS the window's start.
    // Reading loopStart as an x position here would push the marks off the right of the pane.
    const l = clipLoop(
      clip({ type: "audio", length: 12, loopStart: 40, loopEnd: 44 }),
    );
    expect(l).toMatchObject({ from: 0, to: 4, win: 4, passes: 3 });
    expect(l?.repeats).toEqual([4, 8]);
  });

  it("a window played once has no repeats to draw", () => {
    const l = clipLoop(clip({ length: 4, loopStart: 0, loopEnd: 4 }));
    expect(l?.passes).toBe(1);
    expect(l?.repeats).toEqual([]);
  });

  it("treats a clip shorter than its own window as one pass", () => {
    // The engine cuts it off; it is still a pass, and `passes: 0` would draw nothing at all.
    expect(
      clipLoop(clip({ length: 2, loopStart: 0, loopEnd: 8 }))?.passes,
    ).toBe(1);
  });

  it("falls back to the window when the length is unknown", () => {
    // `length: 0` is "to the end of the source" — only the engine knows it.
    expect(
      clipLoop(clip({ length: 0, loopStart: 0, loopEnd: 8 })),
    ).toMatchObject({ win: 8, passes: 1 });
  });
});

describe("visibleRepeats", () => {
  const l = clipLoop(clip({ length: 80, loopStart: 0, loopEnd: 8 }));
  if (!l) throw new Error("fixture has a loop");

  it("draws them when a pass is wide enough to tell apart", () => {
    expect(visibleRepeats(l, 24)).toHaveLength(9);
  });

  it("drops them when it is not — a solid grey block is not information", () => {
    expect(visibleRepeats(l, 0.5)).toEqual([]);
  });
});

describe("placedRepeats", () => {
  it("counts from the EVENT's start, not from the material's", () => {
    // The case the two axes disagree on: a MIDI window that opens at bar 5. On the roll the
    // first repeat is at 8 + 4; on a lane the event's left edge IS the first pass, so it is at 4.
    const l = clipLoop(
      clip({ type: "midi", length: 12, loopStart: 8, loopEnd: 12 }),
    );
    if (!l) throw new Error("fixture has a loop");
    expect(visibleRepeats(l, 24)).toEqual([12, 16]);
    expect(placedRepeats(l, 24)).toEqual([4, 8]);
  });

  it("agrees with the editor's axis for audio, whose window opens at 0", () => {
    const l = clipLoop(
      clip({ type: "audio", length: 12, loopStart: 3, loopEnd: 7 }),
    );
    if (!l) throw new Error("fixture has a loop");
    expect(placedRepeats(l, 24)).toEqual(visibleRepeats(l, 24));
  });

  it("marks nothing for a window that plays once", () => {
    const l = clipLoop(clip({ length: 4, loopStart: 0, loopEnd: 4 }));
    if (!l) throw new Error("fixture has a loop");
    expect(placedRepeats(l, 24)).toEqual([]);
  });

  it("drops them when a pass is too narrow to tell apart", () => {
    const l = clipLoop(clip({ length: 80, loopStart: 0, loopEnd: 8 }));
    if (!l) throw new Error("fixture has a loop");
    expect(placedRepeats(l, 0.5)).toEqual([]);
  });
});

describe("playedZone", () => {
  it("is the WINDOW when the clip states one", () => {
    expect(playedZone(clip({ length: 16, loopStart: 4, loopEnd: 8 }))).toEqual({
      from: 4,
      to: 8,
    });
  });

  it("is the PLACEMENT's extent when it states none", () => {
    // The case `selection consolidate` produces: its window equals its content, so the compiler
    // drops the range as saying nothing (`statedTo`) — and the roll was left with no band on an
    // event that plainly has an extent. A note past `length` sounds nowhere.
    expect(playedZone(clip({ length: 4 }))).toEqual({ from: 0, to: 4 });
  });

  it("is NOTHING for an unplaced clip — a sequence file being written", () => {
    // No placement, so there is no "what this plays": the whole file is the material, and an
    // edit anywhere in it is legitimate.
    expect(playedZone(clip({ length: 0 }))).toBeNull();
  });
});
