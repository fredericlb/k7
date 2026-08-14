// What the piano roll opens on. The regression this pins is measurable and was measured: a looped
// clip framed its PLACED extent, so `da.dub`'s drums opened with the notes in the leftmost 7% of
// the pane and eighty beats of empty grid beside them.

import { describe, expect, it } from "vitest";
import { clipLoop } from "./clipLoop";
import { rollFit } from "./rollFit";
import type { WebClip, WebNote } from "./types";

const note = (time: number, duration = 1, key = 60): WebNote => ({
  time,
  duration,
  key,
});
const clip = (over: Partial<WebClip>): WebClip => ({
  id: "c",
  type: "midi",
  name: "c",
  start: 0,
  length: 0,
  notes: [],
  ...over,
});
/** The fit for a clip, the way PianoRoll asks for it. */
const fitFor = (c: WebClip, barBeats = 4) =>
  rollFit(c.notes, c.length, barBeats, clipLoop(c));

/** What fraction of the framed width the notes occupy — the number in the report. */
const fill = (c: WebClip, barBeats = 4) => {
  const f = fitFor(c, barBeats);
  const end = c.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  return (end - f.loBeat) / f.beats;
};

describe("the time axis", () => {
  it("frames a LOOPED clip on its window, not on its placed extent", () => {
    // LEMO - DANSE, da.dub/drums_2_0: 7.135 beats of notes, 80 beats placed, an 8-beat loop.
    const c = clip({
      length: 80,
      loopStart: 0,
      loopEnd: 8,
      notes: [note(0, 0.5, 36), note(7, 0.135056, 38)],
    });
    const f = fitFor(c);
    expect(f.loBeat).toBe(0);
    expect(f.hiBeat).toBeCloseTo(9.6, 5); // the 8-beat window + 20%
    // The bug: this used to be 96 beats, and the notes filled 7% of it.
    expect(f.beats).toBeCloseTo(9.6, 5);
    expect(fill(c)).toBeGreaterThan(0.7);
  });

  it("still reaches the placed extent with its CANVAS", () => {
    // The later passes and their marks are there to be scrolled to — framing the window must not
    // make them unreachable.
    const f = fitFor(
      clip({ length: 80, loopStart: 0, loopEnd: 8, notes: [note(0)] }),
    );
    expect(f.placedEnd).toBe(80);
    expect(f.canvasBeats).toBeGreaterThanOrEqual(80);
    expect(f.canvasBeats % 4).toBe(0); // whole bars
  });

  it("frames an UNLOOPED clip as it always did", () => {
    // bs.verse/bass_2_0: 19.96 beats of notes in a 20-beat clip — already ~83% full, and the
    // margin is the whole difference. Nothing here may move.
    const c = clip({ length: 20, notes: [note(0), note(18.96, 1)] });
    expect(fill(c)).toBeCloseTo(1 / 1.2, 2);
  });

  it("frames a window that opens past beat 0 with nothing before it", () => {
    // A sequence windowed to bar 3 onwards: the roll opens THERE rather than on the empty bars
    // before it, the same way the pitch axis skips the octaves nothing uses.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.loBeat).toBeCloseTo(7.2, 5); // 8 − 20% of the 4-beat span
    expect(f.hiBeat).toBeCloseTo(12.8, 5);
  });

  it("…but keeps notes that sit BEFORE the window in view", () => {
    // They are in the file and they do not play, which is exactly the thing worth seeing. Framing
    // the window alone would hide them, and their absence would read as data lost.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(0, 1, 60), note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.loBeat).toBe(0);
    expect(f.hiBeat).toBeGreaterThan(12);
  });

  it("includes the loop's END even when the last note falls short of it", () => {
    // Otherwise the marker for where the loop closes sits outside the opening view.
    const f = fitFor(
      clip({ length: 16, loopStart: 0, loopEnd: 16, notes: [note(0, 1)] }),
    );
    expect(f.hiBeat).toBeGreaterThan(16);
  });

  it("gives an empty sequence a bar to look at", () => {
    const f = fitFor(clip({}));
    expect(f.beats).toBeGreaterThanOrEqual(4);
    expect(f.loBeat).toBe(0);
  });

  it("frames a sequence FILE on its notes — length 0 says nothing about extent", () => {
    // The editor's strip builds exactly this: no placement, so no length.
    const f = fitFor(clip({ length: 0, notes: [note(0), note(6, 2)] }));
    expect(f.hiBeat).toBeCloseTo(8 * 1.2, 5);
    expect(f.placedEnd).toBe(8);
  });
});

describe("the pitch axis", () => {
  it("frames the used range with a margin", () => {
    const f = fitFor(clip({ notes: [note(0, 1, 60), note(1, 1, 64)] }));
    expect(f.loKey).toBeLessThan(60);
    expect(f.hiKey).toBeGreaterThan(64);
    expect(f.rows).toBe(f.hiKey - f.loKey + 1);
  });

  it("opens around middle C when there are no notes to frame", () => {
    const f = fitFor(clip({}));
    expect(f.loKey).toBeLessThanOrEqual(48);
    expect(f.hiKey).toBeGreaterThanOrEqual(72);
  });

  it("clamps to the 128 keys that exist", () => {
    const f = fitFor(clip({ notes: [note(0, 1, 0), note(1, 1, 127)] }));
    expect(f.loKey).toBe(0);
    expect(f.hiKey).toBe(127);
  });
});
