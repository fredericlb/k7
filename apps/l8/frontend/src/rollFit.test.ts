// What the piano roll opens on — and, for a clip that states a window, the FRAME it opens with:
// the view spans `from`/`to` plus a margin, while the canvas runs over the whole sequence. It used
// to be a cage (the canvas WAS the window, nothing outside drawn), and it stopped for the reason
// the audio clip panel's did: a window is judged against what lies outside it.

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
  it("FRAMES the window, with a margin, and lets the canvas span the sequence", () => {
    // LEMO - DANSE, da.dub/drums_2_0: 7.135 beats of notes, 80 beats placed, an 8-beat loop.
    // The view opens on the 8-beat window plus a margin either side; the canvas runs over the
    // sequence, so the wheel reaches what the window leaves out.
    const c = clip({
      length: 80,
      loopStart: 0,
      loopEnd: 8,
      notes: [note(0, 0.5, 36), note(7, 0.135056, 38)],
    });
    const f = fitFor(c);
    expect(f.origin).toBe(0);
    expect(f.loBeat).toBe(0); // clamped: there is nothing before beat 0 to show
    expect(f.hiBeat).toBe(10); // 8 + a two-beat margin
    expect(f.canvasBeats).toBe(8); // the sequence, rounded up to a bar
  });

  it("still knows the placed extent — the playhead's bound, not the canvas's", () => {
    const f = fitFor(
      clip({ length: 80, loopStart: 0, loopEnd: 8, notes: [note(0)] }),
    );
    expect(f.placedEnd).toBe(80);
    expect(f.canvasBeats).toBe(8);
  });

  it("keeps the ORIGIN at the sequence's zero, so what is before the window is reachable", () => {
    // It used to be the window's `from`, which put the canvas's left edge at the window and made
    // everything before it unreachable — the cage this replaced.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.origin).toBe(0);
    expect(f.loBeat).toBe(6); // the window, opened out by two beats
    expect(f.hiBeat).toBe(14);
    expect(f.canvasBeats).toBe(12); // …and the whole sequence is on the canvas
  });

  it("does not let a note before the window stretch the PITCH fit", () => {
    // The note at beat 0 sounds in no pass, so it must not drag the pitch axis down to meet it —
    // it is drawn, dimmed, as context. The time axis frames the window either way.
    const f = fitFor(
      clip({
        length: 4,
        loopStart: 8,
        loopEnd: 12,
        notes: [note(0, 1, 20), note(8, 1, 62), note(11, 1, 64)],
      }),
    );
    expect(f.loBeat).toBe(6);
    expect(f.loKey).toBeGreaterThan(20); // fitted to 62..64, not dragged down to the dimmed 20
  });

  it("gives a LONG window a proportional margin, not a fixed one", () => {
    // A fifth of the window either side: what you want around a two-beat window is a beat, and
    // around a sixteen-bar one rather more than that.
    const f = fitFor(
      clip({ length: 16, loopStart: 0, loopEnd: 16, notes: [note(0, 1)] }),
    );
    expect(f.hiBeat).toBeCloseTo(19.2, 6); // 16 + 0.2 × 16
  });

  it("…and a SHORT one at least half a bar, so the frame is never a hairline", () => {
    const f = fitFor(
      clip({ length: 2, loopStart: 4, loopEnd: 5, notes: [note(4, 1)] }),
    );
    expect(f.loBeat).toBe(2); // 4 − 2, the floor rather than 0.2 × 1
    expect(f.hiBeat).toBe(7);
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
