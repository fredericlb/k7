// What the piano roll opens on — and, for a clip that states a window, the cage it may not leave:
// the view spans `from`/`to`, and what is outside the window is not drawn at all.

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

describe("the time axis, windowed", () => {
  it("is the window itself — a looped clip is its pattern, not its placed extent", () => {
    // LEMO - DANSE, da.dub/drums_2_0: 7.135 beats of notes, 80 beats placed, an 8-beat loop.
    // The view is the 8-beat window; the nine later passes are the same picture again.
    const c = clip({
      length: 80,
      loopStart: 0,
      loopEnd: 8,
      notes: [note(0, 0.5, 36), note(7, 0.135056, 38)],
    });
    const f = fitFor(c);
    expect(f.origin).toBe(0);
    expect(f.loBeat).toBe(0);
    expect(f.hiBeat).toBe(8);
    expect(f.beats).toBe(8);
    expect(f.canvasBeats).toBe(8);
  });

  it("still knows the placed extent — the playhead's bound, not the canvas's", () => {
    const f = fitFor(
      clip({ length: 80, loopStart: 0, loopEnd: 8, notes: [note(0)] }),
    );
    expect(f.placedEnd).toBe(80);
    expect(f.canvasBeats).toBe(8);
  });

  it("opens AT a window that starts past beat 0 — the origin is its `from`", () => {
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.origin).toBe(8);
    expect(f.loBeat).toBe(8);
    expect(f.hiBeat).toBe(12);
    expect(f.canvasBeats).toBe(4);
  });

  it("does not let a note BEFORE the window stretch the view or the pitch fit", () => {
    // The note at beat 0 does not sound and is not shown — the window is the whole picture, and
    // the pitch axis is fitted to what the window contains, the same way the time axis is.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(0, 1, 20), note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.loBeat).toBe(8);
    expect(f.loKey).toBeGreaterThan(20); // fitted to 62..64, not dragged down to the hidden 20
  });

  it("ends exactly at the loop's end, even when the last note falls short of it", () => {
    const f = fitFor(
      clip({ length: 16, loopStart: 0, loopEnd: 16, notes: [note(0, 1)] }),
    );
    expect(f.hiBeat).toBe(16);
  });

  it("counts a note OVER the window's edge as inside, for the pitch fit", () => {
    // It is cut at the edge but its visible part is in the view, so its pitch must be framed.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(7, 2, 100), note(9, 1, 60)],
      }),
    );
    expect(f.hiKey).toBeGreaterThanOrEqual(100);
  });
});

describe("the time axis, unwindowed", () => {
  it("frames an UNLOOPED clip on its content with a margin, as it always did", () => {
    // bs.verse/bass_2_0: 19.96 beats of notes in a 20-beat clip — already ~83% full, and the
    // margin is the whole difference. Nothing here may move.
    const c = clip({ length: 20, notes: [note(0), note(18.96, 1)] });
    const f = fitFor(c);
    const end = c.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
    expect((end - f.loBeat) / f.beats).toBeCloseTo(1 / 1.2, 2);
    expect(f.origin).toBe(0);
  });

  it("still reaches the placed extent with its CANVAS", () => {
    const f = fitFor(clip({ length: 80, notes: [note(0)] }));
    expect(f.placedEnd).toBe(80);
    expect(f.canvasBeats).toBeGreaterThanOrEqual(80);
    expect(f.canvasBeats % 4).toBe(0); // whole bars
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
