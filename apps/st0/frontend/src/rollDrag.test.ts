import { describe, expect, it } from "vitest";
import {
  clampKey,
  dragMoved,
  drawSpan,
  groupOffset,
  keyOffset,
  MIN_NOTE_BEATS,
  movesPitch,
  planGroupMove,
  type RollDrag,
  tSpan,
  velAt,
} from "./rollDrag";

const drag = (over: Partial<RollDrag> = {}): RollDrag => ({
  key: 60,
  time: 4,
  dur: 1,
  mode: "move",
  dBeats: 0,
  dKeys: 0,
  ...over,
});

describe("drawSpan", () => {
  it("covers the cell a press never left — one step, not the command's whole beat", () => {
    expect(drawSpan(4.1, 4.1, 0.25, 0, 0.25)).toEqual({ from: 4, to: 4.25 });
  });

  it("covers both ends of a drag, inclusive", () => {
    expect(drawSpan(4.1, 4.9, 0.25, 0, 0.25)).toEqual({ from: 4, to: 5 });
  });

  it("reads the same span backwards", () => {
    expect(drawSpan(4.9, 4.1, 0.25, 0, 0.25)).toEqual(
      drawSpan(4.1, 4.9, 0.25, 0, 0.25),
    );
  });

  it("counts cells off the ORIGIN, so a framed clip's grid is the ruler's", () => {
    expect(drawSpan(9.6, 9.6, 0.5, 8, 0.5)).toEqual({ from: 9.5, to: 10 });
  });

  it("takes the raw beats when Ctrl frees the grid", () => {
    expect(drawSpan(4.13, 4.87, 0, 0, 0.25)).toEqual({ from: 4.13, to: 4.87 });
  });

  it("still gives a freed CLICK a length — the grid's, there being no cell to take", () => {
    expect(drawSpan(4.13, 4.13, 0, 0, 0.25)).toEqual({ from: 4.13, to: 4.38 });
  });
});

describe("tSpan — move", () => {
  it("carries the duration along, and the pitch with it", () => {
    expect(tSpan(drag({ dBeats: 2, dKeys: 3 }))).toEqual({
      key: 63,
      start: 6,
      end: 7,
    });
  });

  it("stops at beat 0 rather than going negative", () => {
    expect(tSpan(drag({ dBeats: -9 }))).toEqual({ key: 60, start: 0, end: 1 });
  });

  it("stops at either end of the keyboard rather than dropping the note", () => {
    expect(tSpan(drag({ key: 2, dKeys: -9 })).key).toBe(0);
    expect(tSpan(drag({ key: 125, dKeys: 9 })).key).toBe(127);
  });
});

describe("tSpan — stretch", () => {
  it("moves the start and leaves the end alone", () => {
    expect(tSpan(drag({ mode: "start", dur: 2, dBeats: -1 }))).toEqual({
      key: 60,
      start: 3,
      end: 6,
    });
  });

  it("never lets the start cross the end", () => {
    expect(tSpan(drag({ mode: "start", dur: 2, dBeats: 5 })).start).toBe(
      6 - MIN_NOTE_BEATS,
    );
  });

  it("never lets the end cross the start", () => {
    expect(tSpan(drag({ mode: "end", dur: 2, dBeats: -5 })).end).toBe(
      4 + MIN_NOTE_BEATS,
    );
  });

  it("keeps its pitch even when the hand wandered off the row", () => {
    expect(tSpan(drag({ mode: "end", dKeys: 7, dBeats: 1 })).key).toBe(60);
    expect(tSpan(drag({ mode: "start", dKeys: -7, dBeats: -0.5 })).key).toBe(
      60,
    );
  });
});

describe("which verb a drag commits", () => {
  it("is a move when the pitch changed", () => {
    expect(movesPitch(drag({ dKeys: 1 }))).toBe(true);
  });

  it("is a timerange when it did not", () => {
    expect(movesPitch(drag({ dBeats: 3 }))).toBe(false);
  });

  it("is a timerange when the clamp swallowed the pitch change", () => {
    expect(movesPitch(drag({ key: 127, dKeys: 4 }))).toBe(false);
  });

  it("is a stretch, never a move, whatever the hand did vertically", () => {
    expect(movesPitch(drag({ mode: "end", dKeys: 4 }))).toBe(false);
  });

  it("writes nothing at all when the press has not travelled", () => {
    expect(dragMoved(drag())).toBe(false);
    expect(dragMoved(drag({ dKeys: 1 }))).toBe(true);
    expect(dragMoved(drag({ dBeats: 0.25 }))).toBe(true);
  });
});

describe("keyOffset", () => {
  it("is positive UP: the screen counts down and the keyboard counts up", () => {
    expect(keyOffset(-24, 12)).toBe(2);
    expect(keyOffset(24, 12)).toBe(-2);
  });

  it("snaps to the row, half a row landing on one", () => {
    expect(keyOffset(-7, 12)).toBe(1);
    expect(keyOffset(-5, 12)).toBe(0);
  });

  it("answers 0 for an unmeasured row rather than dividing by it", () => {
    expect(keyOffset(-24, 0)).toBe(0);
  });
});

describe("velAt", () => {
  it("is 1 at the row's top and 0 at its bottom", () => {
    expect(velAt(0, 13)).toBe(1);
    expect(velAt(12, 13)).toBe(0);
  });

  it("clamps a pointer dragged past either edge", () => {
    expect(velAt(-40, 13)).toBe(1);
    expect(velAt(40, 13)).toBe(0);
  });

  it("is 1 when the row is too short to hold a scale", () => {
    expect(velAt(4, 1)).toBe(1);
  });
});

describe("clampKey", () => {
  it("rounds to a whole semitone", () => {
    expect(clampKey(60.4)).toBe(60);
    expect(clampKey(60.6)).toBe(61);
  });
});

describe("dragging a selection", () => {
  const chord = [
    { key: 60, time: 1, duration: 1 },
    { key: 64, time: 1, duration: 1, vel: 0.5 },
    { key: 67, time: 2, duration: 0.5 },
  ];

  it("moves every note by the same beats and semitones", () => {
    expect(planGroupMove(chord, [], 1, 2)).toEqual({
      moves: [
        [60, 1, 62, 2],
        [64, 1, 66, 2],
        [67, 2, 69, 3],
      ],
      dBeats: 1,
      dKeys: 2,
    });
  });

  it("stops the WHOLE group at an edge, so a chord keeps its shape", () => {
    // Up by 70 would push G4 past 127: the group stops when its top note reaches it.
    expect(groupOffset(chord, 0, 70)).toEqual({ dBeats: 0, dKeys: 60 });
    // Left by 5 beats stops when the earliest note reaches beat 0.
    expect(groupOffset(chord, -5, 0)).toEqual({ dBeats: -1, dKeys: 0 });
  });

  it("refuses a note that stays in the way, and a drag that ends where it began", () => {
    const stays = [{ key: 62, time: 2, duration: 1 }];
    expect(planGroupMove(chord, stays, 1, 2)).toEqual({ refused: "occupied" });
    expect(planGroupMove(chord, [], 0.0000001, 0)).toEqual({
      refused: "still",
    });
  });
});
