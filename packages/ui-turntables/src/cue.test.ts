// A cue point is a place in the FILE; `seek` takes a place on the TIMELINE. Everything below
// is that one conversion, which is invisible until somebody has stretched a deck — and then
// every cue on it is wrong, quietly and only on that deck.

import { describe, expect, it } from "vitest";
import {
  CUE_COLOURS,
  type DeckTempo,
  playFrom,
  sourceAt,
  TIMELINE_BASE,
  transportAt,
} from "./deck";

/** Every transport number below sits where a deck's clip does — the FILE's are absolute, the timeline's never were. */
const on = (seconds: number) => TIMELINE_BASE + seconds;

const at = (natural: number, target: number, align?: number): DeckTempo => ({
  natural,
  seconds: 300,
  target,
  ...(align === undefined ? {} : { align }),
});

describe("where a cue lands on the transport", () => {
  it("is the same number when nothing is stretched", () => {
    expect(transportAt(48, at(120, 120))).toBeCloseTo(on(48));
    expect(sourceAt(on(48), at(120, 120))).toBeCloseTo(48);
  });

  it("moves EARLIER on a deck that has been sped up", () => {
    // A song of 120 played at 150 runs at 0.8× its own clock, so its 60 s mark arrives at 48 s.
    expect(transportAt(60, at(120, 150))).toBeCloseTo(on(48));
    expect(sourceAt(on(48), at(120, 150))).toBeCloseTo(60);
  });

  it("moves LATER on a deck that has been slowed down", () => {
    expect(transportAt(60, at(120, 96))).toBeCloseTo(on(75));
    expect(sourceAt(on(75), at(120, 96))).toBeCloseTo(60);
  });

  it("carries sync's alignment with it", () => {
    // The clip is delayed to meet the other deck, so a cue that ignored it would miss by the delay.
    const t = at(120, 120, 1); // one document beat at 120 bpm = 0.5 s
    expect(transportAt(60, t)).toBeCloseTo(on(60.5));
    expect(sourceAt(on(60.5), t)).toBeCloseTo(60);
  });

  it("round-trips, which is what dropping a cue and pressing it needs", () => {
    for (const tempo of [at(120, 150), at(90, 128, 0.8), at(174, 174)])
      for (const s of [0, 12.5, 137.25])
        expect(sourceAt(transportAt(s, tempo), tempo)).toBeCloseTo(s, 6);
  });

  it("passes the number through when the song has no tempo yet", () => {
    // The seconds between the load and the analysis: an invented ratio would place a cue by nothing.
    expect(transportAt(30, undefined)).toBeCloseTo(on(30));
    expect(transportAt(30, at(0, 0))).toBeCloseTo(on(30));
    expect(sourceAt(on(30), undefined)).toBeCloseTo(30);
  });

  it("never answers before the start of the file", () => {
    // An aligned deck can put the transport BEFORE its clip, and negative is not a place in a file.
    expect(sourceAt(0, at(120, 120, 4))).toBe(0);
  });

  it("starts PLAY at the music, not at the top of the timeline", () => {
    // The first ten minutes are guaranteed silence, so Play from there does visibly nothing (docs/bpm.md).
    expect(playFrom(0)).toBe(TIMELINE_BASE);
    expect(playFrom(15)).toBe(TIMELINE_BASE);
    expect(playFrom(TIMELINE_BASE - 1)).toBe(TIMELINE_BASE);
  });

  it("leaves a transport that is already in the music alone", () => {
    // Null is "roll from here": anything else restarts the record under a DJ's hands.
    expect(playFrom(TIMELINE_BASE)).toBeNull();
    expect(playFrom(TIMELINE_BASE + 90)).toBeNull();
  });

  it("does NOT rewind somebody who ran off the end", () => {
    // Past both songs is silence too, and deliberately left alone — see ../docs/bpm.md.
    expect(playFrom(TIMELINE_BASE + 99_999)).toBeNull();
  });

  it("carries the SLIP too, so a fader that moved does not move the cues", () => {
    // The slip is where the pitch fader has already carried this deck, so a cue must carry it too.
    const t: DeckTempo = {
      natural: 120,
      seconds: 300,
      target: 120,
      slip: -2.5,
    };
    expect(transportAt(60, t)).toBeCloseTo(on(57.5));
    expect(sourceAt(on(57.5), t)).toBeCloseTo(60);
  });
});

describe("the cue colours", () => {
  it("has one per button, and no two alike", () => {
    // A hot cue works because a hand finds it without reading, which two identical colours undo.
    expect(CUE_COLOURS).toHaveLength(8);
    expect(new Set(CUE_COLOURS).size).toBe(8);
  });
});
