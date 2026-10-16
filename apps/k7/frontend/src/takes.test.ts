// The takes view's arithmetic: an event found from any of its pieces, which spans each row is heard
// over, and the two lines it sends — a pick and an arm.

import { describe, expect, it } from "vitest";
import {
  armLine,
  compFadeLine,
  compLine,
  compSeams,
  eventIdOf,
  heardSpans,
  pieceEdgeLines,
  snapSpan,
  TAKE_COLORS,
  takeColor,
  takesEventOf,
} from "./takes";
import type { WebProject } from "./types";

// A riff at bar 2 (beat 4), its take t2 played over beats 6..8 — two pieces on the lane.
const project = {
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  tracks: [
    {
      id: "keys",
      clips: [
        {
          id: "riff@4",
          type: "midi",
          name: "riff",
          start: 4,
          length: 2,
          comp: { of: "riff@4", take: "riff" },
          event: {
            takes: [{ ref: "t2", start: "2:3" }],
            comp: [{ take: "t2", from: "2:3", to: "3:1" }],
            crossfades: [{ at: "2:3", length: "0:0:1" }],
          },
          notes: [],
        },
        {
          id: "t2@6",
          type: "midi",
          name: "t2",
          start: 6,
          length: 2,
          comp: { of: "riff@4", take: "t2" },
          notes: [],
        },
        {
          id: "other@16",
          type: "midi",
          name: "other",
          start: 16,
          length: 4,
          notes: [],
        },
      ],
    },
  ],
} as unknown as WebProject;

describe("takesEventOf", () => {
  it("finds the event from any of its pieces, with its own row first", () => {
    const piece = project.tracks[0].clips[1];
    expect(eventIdOf(piece)).toBe("riff@4");
    const ev = takesEventOf(project, "keys", eventIdOf(piece));
    expect(ev).toMatchObject({
      ref: "riff",
      start: 4,
      at: "2:1",
      kind: "midi",
      from: 4,
      to: 8,
    });
    expect(ev?.rows).toEqual([
      { ref: "riff", start: 4, own: true },
      { ref: "t2", start: 6, own: false },
    ]);
    expect(ev?.comp).toEqual([{ take: "t2", from: 6, to: 8 }]);
  });

  it("says nothing for a clip that is not on that lane", () => {
    expect(takesEventOf(project, "keys", "nope@1")).toBeNull();
  });
});

describe("heardSpans", () => {
  it("is a take's comp spans, and the event's own material where no span is", () => {
    const ev = takesEventOf(project, "keys", "riff@4");
    if (!ev) throw new Error("no event");
    expect(heardSpans(ev, ev.rows[1], 10)).toEqual([{ from: 6, to: 8 }]);
    expect(heardSpans(ev, ev.rows[0], 12)).toEqual([
      { from: 4, to: 6 },
      { from: 8, to: 12 },
    ]);
  });
});

describe("the lines it sends", () => {
  it("snaps a drag to the grid, and takes a click for no span", () => {
    expect(snapSpan(6.9, 5.1, 1)).toEqual({ from: 5, to: 7 });
    expect(snapSpan(6.1, 6.2, 1)).toBeNull();
  });

  it("spells a pick and an arm in timecodes", () => {
    const ev = takesEventOf(project, "keys", "riff@4");
    if (!ev) throw new Error("no event");
    expect(compLine(ev, "t2", { from: 6, to: 8 }, 4, 4)).toBe(
      "event comp keys 2:1 t2 2:3 3:1",
    );
    expect(armLine(ev, 6, null, 4, 4)).toBe("event take arm keys 2:1 2:3");
    expect(armLine(ev, 6, 8, 4, 4)).toBe("event take arm keys 2:1 2:3 3:1");
  });
});

describe("the comp's seams", () => {
  it("are where two pieces meet inside the event, and a crossfade line names one", () => {
    const ev = takesEventOf(project, "keys", "riff@4");
    if (!ev) throw new Error("no event");
    expect(ev.crossfades).toEqual([{ at: 6, length: 0.5 }]);
    expect(compSeams(ev)).toEqual([6]);
    expect(compFadeLine(ev, 6, 0.5, 4, 4)).toBe(
      "event comp fade keys 2:1 2:3 0:0:1",
    );
    expect(compFadeLine(ev, 6, 0, 4, 4)).toBe("event comp fade keys 2:1 2:3 0");
  });
});

describe("a piece's edges, dragged in the waveform", () => {
  const ev = takesEventOf(project, "keys", "riff@4");
  if (!ev) throw new Error("no event");
  const [own, take] = ev.pieces;

  it("lists the event's pieces in order, and colours each take as its row", () => {
    expect(ev.pieces.map((p) => p.id)).toEqual(["riff@4", "t2@6"]);
    expect(takeColor(ev, "riff")).toBe(TAKE_COLORS[0]);
    expect(takeColor(ev, "t2")).toBe(TAKE_COLORS[1]);
  });

  it("grows a piece into its neighbour: its take takes the larger span", () => {
    expect(pieceEdgeLines(ev, take, 5, 8, 4, 4)).toEqual([
      "event comp keys 2:1 t2 2:2 3:1",
    ]);
  });

  it("shrinks a piece: what it lets go goes back to the piece it touches", () => {
    expect(pieceEdgeLines(ev, take, 7, 8, 4, 4)).toEqual([
      "event comp keys 2:1 riff 2:3 2:4",
    ]);
    // The event's own piece let go at its end: the take beside it plays there.
    expect(pieceEdgeLines(ev, own, 4, 5, 4, 4)).toEqual([
      "event comp keys 2:1 t2 2:2 2:3",
    ]);
  });
});
