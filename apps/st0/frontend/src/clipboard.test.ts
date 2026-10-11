// What a rectangle copies and where a paste lands. Pure, so the two halves that have to agree —
// "relative to the corner" going in, "offset by the caret" coming out — are pinned here rather
// than discovered by pasting a chord a fourth too low.

import { describe, expect, it } from "vitest";
import {
  type Clipboard,
  copyEvents,
  copyNotes,
  droppedCount,
  pasteEvents,
  pasteNotes,
} from "./clipboard";

const note = (key: number, time: number, duration = 1, vel?: number) => ({
  key,
  time,
  duration,
  ...(vel === undefined ? {} : { vel }),
});

describe("copying notes", () => {
  const notes = [
    note(60, 0), // in
    note(62, 1.5), // in
    note(48, 2), // below the pitch range
    note(60, 8), // past the right edge
    note(64, 3.9, 4), // starts inside, runs well past — in, and kept WHOLE
  ];

  it("takes what STARTS inside, on both axes", () => {
    const c = copyNotes(notes, "riff", 60, 67, 0, 4);
    expect(c?.kind).toBe("notes");
    if (c?.kind !== "notes") return;
    expect(c.notes).toHaveLength(3);
  });

  it("carries a note's LENGTH whole, uncut by the edge", () => {
    // A copy is of the material: a note trimmed to the rectangle would come back shorter than the one that was selected.
    const c = copyNotes(notes, "riff", 60, 67, 0, 4);
    if (c?.kind !== "notes") return;
    expect(c.notes.find((n) => n.t === 3.9)?.d).toBe(4);
  });

  it("is RELATIVE to the corner — rows down, beats right", () => {
    const c = copyNotes(notes, "riff", 60, 67, 1, 4);
    if (c?.kind !== "notes") return;
    // key 62 in a rectangle topped at 67 is five rows down; beat 1.5 from a left edge of 1 is 0.5.
    expect(c.notes[0]).toEqual({ k: 5, t: 0.5, d: 1 });
  });

  it("drops a velocity of 1 — absent IS the default (see WebNote)", () => {
    const c = copyNotes(
      [note(60, 0, 1, 1), note(61, 0, 1, 0.4)],
      "r",
      60,
      61,
      0,
      4,
    );
    if (c?.kind !== "notes") return;
    expect(c.notes.find((n) => n.k === 1)?.v).toBeUndefined();
    expect(c.notes.find((n) => n.k === 0)?.v).toBe(0.4);
  });

  it("an empty rectangle copies NOTHING, not an empty clipboard", () => {
    expect(copyNotes(notes, "riff", 100, 110, 0, 4)).toBeNull();
  });
});

describe("pasting notes", () => {
  const clip = copyNotes(
    [note(60, 0), note(62, 1.5, 2, 0.4)],
    "riff",
    60,
    67,
    0,
    4,
  ) as Clipboard;

  it("puts the rectangle's top-left under the caret", () => {
    const out = pasteNotes(clip, 67, 8);
    expect(out).toContainEqual({ k: 60, t: 8, d: 1 });
    expect(out).toContainEqual({ k: 62, t: 9.5, d: 2, v: 0.4 });
  });

  it("transposes and shifts together when the caret moved both ways", () => {
    const out = pasteNotes(clip, 72, 0);
    expect(out.map((n) => n.k).sort((a, b) => a - b)).toEqual([65, 67]);
  });

  it("DROPS what falls off the keyboard rather than clamping it", () => {
    // A chord squashed onto key 0 is not the chord you copied — the rectangle was topped at 67, so a caret on key 6 leaves room for one.
    const out = pasteNotes(clip, 6, 0);
    expect(out).toEqual([{ k: 1, t: 1.5, d: 2, v: 0.4 }]);
    expect(droppedCount(out.length, clip)).toBe(1);
  });

  it("keeps each note's own pitch when pasted at the rectangle's top — the roll's paste", () => {
    const top = clip.kind === "notes" ? clip.top : Number.NaN;
    expect(top).toBe(67);
    const out = pasteNotes(clip, top, 16);
    expect(out).toContainEqual({ k: 60, t: 16, d: 1 });
    expect(out).toContainEqual({ k: 62, t: 17.5, d: 2, v: 0.4 });
  });

  it("drops what a negative offset would push before the start", () => {
    expect(pasteNotes(clip, 67, -4)).toHaveLength(0);
  });

  it("refuses to paste the other KIND", () => {
    const ev = copyEvents(
      [{ events: [{ ref: "a", start: 0 }] }],
      0,
      4,
    ) as Clipboard;
    expect(pasteNotes(ev, 60, 0)).toEqual([]);
  });
});

describe("copying events", () => {
  const rows = [
    {
      events: [
        { ref: "kick", start: 0 },
        { ref: "kick", start: 8 },
      ],
    },
    { events: [{ ref: "snare", start: 2, event: { loop: 4 } }] },
  ];

  it("takes what starts inside, keyed by the row's offset", () => {
    const c = copyEvents(rows, 0, 4);
    if (c?.kind !== "events") return;
    expect(c.events).toEqual([
      { row: 0, ref: "kick", start: 0 },
      { row: 1, ref: "snare", start: 2, loop: 4 },
    ]);
    expect(c.rows).toBe(2);
  });

  /** The whole placement, not just where it sat: a compiled clip has its material merged in, so `ref` and `start` were all a copy read back. */
  it("carries every attribute the placement stated", () => {
    const c = copyEvents(
      [
        {
          events: [
            {
              ref: "gtr",
              start: 0,
              event: {
                from: 1.5,
                to: 6.5455,
                fadeIn: "0:2",
                fadeOut: "0:1",
                loop: 3,
                disabled: true,
                warp: false,
              },
            },
          ],
        },
      ],
      0,
      4,
    );
    if (c?.kind !== "events") return;
    expect(c.events[0]).toEqual({
      row: 0,
      ref: "gtr",
      start: 0,
      from: 1.5,
      to: 6.5455,
      fadeIn: "0:2",
      fadeOut: "0:1",
      loop: 3,
      disabled: true,
      warp: false,
    });
  });

  // A timecode window survives as the STRING it was written as: re-spelling it in seconds would bake today's tempo into it.
  it("keeps a window spelled as a timecode spelled that way", () => {
    const c = copyEvents(
      [{ events: [{ ref: "s", start: 0, event: { from: "2:1", to: "4:1" } }] }],
      0,
      4,
    );
    if (c?.kind !== "events") return;
    expect(c.events[0].from).toBe("2:1");
    expect(c.events[0].to).toBe("4:1");
  });

  /** Only what the file SAID: a default written out is one the paste would then write into the new lane's file. */
  it("leaves out the defaults", () => {
    const c = copyEvents(
      [{ events: [{ ref: "a", start: 0, event: { loop: 1, warp: true } }] }],
      0,
      4,
    );
    if (c?.kind !== "events") return;
    expect(c.events[0]).toEqual({ row: 0, ref: "a", start: 0 });
  });

  // An event that stated nothing copies as the three fields it has, which is also what keeps the payload of a big paste small.
  it("adds nothing to an event that said nothing", () => {
    const c = copyEvents([{ events: [{ ref: "a", start: 0 }] }], 0, 4);
    if (c?.kind !== "events") return;
    expect(c.events[0]).toEqual({ row: 0, ref: "a", start: 0 });
  });

  // The shape the CARET's copy takes with no rectangle drawn: one lane, and the clicked clip's own span (TimelineTab's `copy`).
  it("one lane and one clip's span copies that clip alone", () => {
    // The caret parked on the SECOND kick; the placement at 0 on the same lane must not come along.
    const c = copyEvents([rows[0]], 8, 12);
    if (c?.kind !== "events") return;
    expect(c.events).toEqual([{ row: 0, ref: "kick", start: 0 }]);
    expect(c.rows).toBe(1);
    expect(c.beats).toBe(4);
  });

  // …and parked on bare lane it answers null, which is what makes the shell say 'nothing to copy'.
  it("answers null where the caret is on nothing", () => {
    expect(copyEvents([rows[0]], 100, 104)).toBeNull();
  });
});

describe("pasting events", () => {
  const clip = copyEvents(
    [
      { events: [{ ref: "kick", start: 0 }] },
      { events: [{ ref: "snare", start: 2 }] },
    ],
    0,
    4,
  ) as Clipboard;

  it("lands on the lanes from the caret DOWN", () => {
    expect(pasteEvents(clip, ["gtr", "bass"], 16)).toEqual([
      { track: "gtr", ref: "kick", start: 16 },
      { track: "bass", ref: "snare", start: 18 },
    ]);
  });

  it("DROPS the rows with no lane under them rather than stacking them", () => {
    const out = pasteEvents(clip, ["gtr"], 0);
    expect(out).toEqual([{ track: "gtr", ref: "kick", start: 0 }]);
    expect(droppedCount(out.length, clip)).toBe(1);
  });

  it("refuses to paste the other KIND", () => {
    const notes = copyNotes([note(60, 0)], "r", 60, 60, 0, 4) as Clipboard;
    expect(pasteEvents(notes, ["gtr"], 0)).toEqual([]);
  });

  /** `start` moves; the window and the fades do NOT — they measure into the MATERIAL, where `start` is a position in the arrangement. */
  it("moves the start and leaves the material's coordinates alone", () => {
    const c = copyEvents(
      [
        {
          events: [
            {
              ref: "gtr",
              start: 4,
              event: { from: 1.5, to: 6.5455, fadeIn: "0:2", loop: 3 },
            },
          ],
        },
      ],
      4,
      8,
    ) as Clipboard;
    expect(pasteEvents(c, ["bass"], 64)).toEqual([
      {
        track: "bass",
        ref: "gtr",
        start: 64,
        from: 1.5,
        to: 6.5455,
        fadeIn: "0:2",
        loop: 3,
      },
    ]);
  });
});
