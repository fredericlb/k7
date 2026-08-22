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

/** Every transport number below is measured from where a deck's clip actually sits — see
 *  `TIMELINE_BASE`. The FILE's numbers are absolute; the timeline's never were. */
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
    // The whole point. A song of 120 played at 150 runs at 0.8× its own clock, so its 60 s
    // mark arrives at 48 s. A cue stored as "48 s on the transport" would be the drop today
    // and a bar early tomorrow.
    expect(transportAt(60, at(120, 150))).toBeCloseTo(on(48));
    expect(sourceAt(on(48), at(120, 150))).toBeCloseTo(60);
  });

  it("moves LATER on a deck that has been slowed down", () => {
    expect(transportAt(60, at(120, 96))).toBeCloseTo(on(75));
    expect(sourceAt(on(75), at(120, 96))).toBeCloseTo(60);
  });

  it("carries sync's alignment with it", () => {
    // The clip itself is delayed to meet the other deck. A cue that ignored that would be off
    // by the alignment on exactly the deck somebody has just beat-matched — the one they are
    // about to drop.
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
    // The seconds between the load and the analysis landing. Inventing a ratio there would
    // place a cue by a number nobody measured.
    expect(transportAt(30, undefined)).toBeCloseTo(on(30));
    expect(transportAt(30, at(0, 0))).toBeCloseTo(on(30));
    expect(sourceAt(on(30), undefined)).toBeCloseTo(30);
  });

  it("never answers before the start of the file", () => {
    // A deck aligned late can put the transport BEFORE its own clip. Negative is not a place
    // in a file, and `seek` would clamp it anyway — saying 0 is the honest version.
    expect(sourceAt(0, at(120, 120, 4))).toBe(0);
  });

  it("starts PLAY at the music, not at the top of the timeline", () => {
    // The bug this is here for: the first ten minutes of this timeline are guaranteed silence
    // (a deck's clip begins at TIMELINE_BASE), so a transport left anywhere in them turns Play
    // into a button that visibly does nothing — the playhead advances and the meters stay dead.
    // Measured on a real set: master -100 dB from 0, -11.8 dB from TIMELINE_BASE.
    expect(playFrom(0)).toBe(TIMELINE_BASE);
    expect(playFrom(15)).toBe(TIMELINE_BASE);
    expect(playFrom(TIMELINE_BASE - 1)).toBe(TIMELINE_BASE);
  });

  it("leaves a transport that is already in the music alone", () => {
    // Null is "roll from here". Anything else would restart the record under a DJ's hands —
    // including, at the boundary, a deck that has just been seeked to its own top.
    expect(playFrom(TIMELINE_BASE)).toBeNull();
    expect(playFrom(TIMELINE_BASE + 90)).toBeNull();
  });

  it("does NOT rewind somebody who ran off the end", () => {
    // Past both songs is silence too, and is deliberately left alone: it is a state you can see
    // on the waveform and fix with a cue, where being before the start looks like a dead engine.
    // Rewinding to the top of the set would be the worse surprise.
    expect(playFrom(TIMELINE_BASE + 99_999)).toBeNull();
  });

  it("carries the SLIP too, so a fader that moved does not move the cues", () => {
    // The slip is where the pitch fader has already carried this deck. A cue that ignored it
    // would drift by exactly as much as the deck had been nudged — on the deck being nudged.
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
    // A hot cue works because your hand knows where it is without reading. Two slots wearing
    // one colour would undo exactly that.
    expect(CUE_COLOURS).toHaveLength(8);
    expect(new Set(CUE_COLOURS).size).toBe(8);
  });
});
