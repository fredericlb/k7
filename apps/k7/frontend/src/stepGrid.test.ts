import { describe, expect, it } from "vitest";
import { rackFor } from "./rackFor";
import {
  NUDGE_MAX,
  noteInCell,
  notesByCell,
  nudgedTime,
  nudgeOf,
  type PadEdit,
  PRECISIONS,
  planSelectionDelete,
  planSelectionMove,
  settledEdits,
  stepCells,
  unknownKeys,
} from "./stepGrid";
import type { WebNote } from "./types";

// The step sequencer's decisions — which panel a MIDI clip opens in, and the grid its window divides into; the buttons are a table around these.

const note = (time: number, key: number, duration = 0.5): WebNote => ({
  time,
  duration,
  key,
});

describe("the grid", () => {
  it("offers 1/2 down to 1/32 notes, a 1/32 step being an eighth of a beat", () => {
    expect(PRECISIONS.map((p) => p.label)).toEqual([
      "1/2",
      "1/4",
      "1/8",
      "1/16",
      "1/32",
    ]);
    const p32 = PRECISIONS.find((p) => p.label === "1/32");
    // One bar of 4/4 at 1/32 is thirty-two cells, counted rather than accumulated, so the last sits exactly on 3.875.
    const cells = stepCells(0, 4, p32?.beats ?? 0);
    expect(cells).toHaveLength(32);
    expect(cells.at(-1)).toBe(3.875);
  });

  it("divides the window at the chosen precision, in absolute beats", () => {
    // An 8-beat window at 1/8 notes (half a beat) is sixteen cells.
    expect(stepCells(0, 8, 0.5)).toHaveLength(16);
    // A windowed clip's cells start at ITS origin, on the same axis its notes use.
    expect(stepCells(8, 4, 1)).toEqual([8, 9, 10, 11]);
  });

  it("keeps a last, partial cell rather than dropping the tail", () => {
    expect(stepCells(0, 3, 2)).toEqual([0, 2]);
  });

  it("has nothing to draw for an empty window or step", () => {
    expect(stepCells(0, 0, 1)).toEqual([]);
    expect(stepCells(0, 4, 0)).toEqual([]);
  });

  it("does not drift on a fine grid — counted, not accumulated", () => {
    const cells = stepCells(0, 64, 0.25);
    expect(cells).toHaveLength(256);
    expect(cells[255]).toBeCloseTo(63.75, 9);
  });
});

describe("what lights a cell", () => {
  const notes = [note(0, 36), note(1.25, 36), note(2, 38)];

  it("is a note on the row's key starting inside the cell", () => {
    expect(noteInCell(notes, 36, 0, 0.5)).toBe(notes[0]);
    expect(noteInCell(notes, 38, 2, 0.5)).toBe(notes[2]);
    expect(noteInCell(notes, 36, 2, 0.5)).toBeNull(); // right cell, other key
  });

  it("claims a note drawn OFF the grid lines, so a played take still shows", () => {
    // 1.25 is not a 1/8 line's start but it is inside the cell at 1, and toggling that cell off must address the note where it really is.
    expect(noteInCell(notes, 36, 1, 0.5)).toBe(notes[1]);
    expect(noteInCell(notes, 36, 1.5, 0.5)).toBeNull(); // …and only that cell claims it
  });

  it("turns the keys the rack has no row for into EXTRA rows, high first", () => {
    expect(unknownKeys(notes, [36], 0, 8)).toEqual([38]);
    expect(unknownKeys(notes, [36, 38], 0, 8)).toEqual([]);
    // Distinct — three stray hits on one key are one row…
    expect(
      unknownKeys(
        [...notes, { time: 3, duration: 0.5, key: 40 }],
        [36, 38],
        0,
        8,
      ),
    ).toEqual([40]);
    // …and inside the window only: the cage already says what it hides.
    expect(unknownKeys(notes, [38], 0, 1)).toEqual([36]); // only the k36 at 0
  });
});

describe("rackFor — which panel a clip opens in", () => {
  const rack = [
    { symbol: "BD", note: 36 },
    { symbol: "SN", note: 38 },
  ];

  it("finds the rack in the chain the track feeds", () => {
    const g = {
      chains: {
        drums: { from: "drums", use: [{ module: "kit", rack }], out: [] },
      },
      tracks: ["drums"],
      warnings: [],
    };
    expect(rackFor(g, "drums")).toBe(rack);
  });

  it("follows the outs to a rack further down", () => {
    const g = {
      chains: {
        a: {
          from: "drums",
          use: [{ module: "eq" }],
          out: [{ to: "b", gain: 1 }],
        },
        b: { use: [{ module: "kit", rack }], out: [] },
      },
      tracks: ["drums"],
      warnings: [],
    };
    expect(rackFor(g, "drums")).toBe(rack);
  });

  it("answers null when the signal never meets one — the roll's case", () => {
    const g = {
      chains: {
        a: { from: "melody", use: [{ module: "synth" }], out: [] },
      },
      tracks: ["melody"],
      warnings: [],
    };
    expect(rackFor(g, "melody")).toBeNull();
    expect(rackFor(null, "melody")).toBeNull();
  });

  it("survives a routing cycle", () => {
    const g = {
      chains: {
        a: { from: "drums", use: [], out: [{ to: "b", gain: 1 }] },
        b: { use: [], out: [{ to: "a", gain: 1 }] },
      },
      tracks: ["drums"],
      warnings: [],
    };
    expect(rackFor(g, "drums")).toBeNull();
  });
});

// Editing has to feel instant while the document takes ~half a second to agree, and the grid must not rescan every note per cell meanwhile.
describe("notesByCell", () => {
  const notes = [note(0, 36), note(1.25, 36), note(2, 38)];

  it("indexes each note by its cell, agreeing with noteInCell", () => {
    const by = notesByCell(notes, 0, 8, 0.5);
    expect(by.get("36@0")).toBe(notes[0]);
    // 1.25 is off the grid lines: it belongs to the cell at 1, index 2 — as noteInCell says.
    expect(by.get("36@2")).toBe(notes[1]);
    expect(noteInCell(notes, 36, 1, 0.5)).toBe(notes[1]);
    expect(by.get("38@4")).toBe(notes[2]);
    expect(by.size).toBe(3);
  });

  it("drops what falls outside the window, and keeps the FIRST of a collision", () => {
    const dup = note(0.1, 36);
    const by = notesByCell([notes[0], dup, note(99, 36)], 0, 8, 0.5);
    expect(by.get("36@0")).toBe(notes[0]);
    expect(by.size).toBe(1);
  });

  it("indexes from the window's own origin", () => {
    expect(notesByCell([note(8.5, 36)], 8, 4, 0.5).get("36@1")).toBeDefined();
  });
});

describe("settledEdits", () => {
  const on = (vel?: number): PadEdit => ({
    on: true,
    ...(vel === undefined ? {} : { vel }),
  });
  const off: PadEdit = { on: false };

  it("forgets an edit the document now agrees with", () => {
    const by = new Map([["36@0", note(0, 36)]]);
    expect(settledEdits(new Map([["36@0", on()]]), by)).toEqual(["36@0"]);
    expect(settledEdits(new Map([["38@1", off]]), by)).toEqual(["38@1"]);
  });

  it("HOLDS one still in flight, so the cell does not flicker back", () => {
    const empty = new Map<string, WebNote>();
    expect(settledEdits(new Map([["36@0", on()]]), empty)).toEqual([]);
    const by = new Map([["36@0", note(0, 36)]]);
    expect(settledEdits(new Map([["36@0", off]]), by)).toEqual([]);
  });

  it("waits for the VELOCITY too, not merely for the note", () => {
    const by = new Map([["36@0", { ...note(0, 36), vel: 0.5 }]]);
    expect(settledEdits(new Map([["36@0", on(0.8)]]), by)).toEqual([]);
    expect(settledEdits(new Map([["36@0", on(0.5)]]), by)).toEqual(["36@0"]);
    // A note the file states nothing for IS full — the schema's default.
    const full = new Map([["36@0", note(0, 36)]]);
    expect(settledEdits(new Map([["36@0", on(1)]]), full)).toEqual(["36@0"]);
  });

  // …and for the NUDGE: a ghost dropped before the move landed would snap the pad back to the step for the length of a round trip.
  it("waits for the nudge, and cannot read one without the step", () => {
    const at = (t: number) => new Map([["36@0", note(t, 36)]]);
    const cell = () => 0;
    const edit = new Map([["36@0", { on: true, nudge: 25 } as PadEdit]]);
    expect(settledEdits(edit, at(0), cell, 1)).toEqual([]);
    expect(settledEdits(edit, at(0.25), cell, 1)).toEqual(["36@0"]);
    // No cell start, no reading: the edit waits rather than being declared done on a guess.
    expect(settledEdits(edit, at(0.25))).toEqual([]);
  });
});

describe("nudgeOf / nudgedTime", () => {
  it("reads how far into its step a note sits, in hundredths", () => {
    expect(nudgeOf(2, 2, 0.5)).toBe(0);
    expect(nudgeOf(2.125, 2, 0.5)).toBe(25);
    expect(nudgeOf(2.4975, 2, 0.5)).toBe(100 - 1); // clamped at the step's far edge
  });

  // A recorded take lands where it landed; the pad says which hundredth that is nearest.
  it("rounds a position rather than demanding one", () => {
    expect(nudgeOf(2.0031, 2, 0.5)).toBe(1);
    expect(nudgeOf(2.0029, 2, 0.5)).toBe(1);
  });

  it("stays inside its own step, whichever way it is pushed", () => {
    expect(nudgeOf(1.9, 2, 0.5)).toBe(0);
    expect(nudgeOf(9, 2, 0.5)).toBe(NUDGE_MAX);
    expect(nudgedTime(2, 0.5, -5)).toBe(2);
    expect(nudgedTime(2, 0.5, 200)).toBeCloseTo(2 + 0.99 * 0.5, 9);
  });

  it("round-trips a nudge through the beat it names", () => {
    for (const n of [0, 1, 37, 99])
      expect(nudgeOf(nudgedTime(4, 0.25, n), 4, 0.25)).toBe(n);
  });

  // A beat that goes in a FILE and is then used to find the note again: `4.092500000000001` is noise in a diff and a different string.
  it("writes a beat a file can hold and an edit can address", () => {
    expect(nudgedTime(4, 0.25, 37)).toBe(4.0925);
    expect(nudgedTime(2, 0.5, 33)).toBe(2.165);
    for (const n of [7, 33, 61, 99])
      expect(String(nudgedTime(4, 0.25, n))).not.toMatch(/\d{8}/);
  });
});

describe("dragging a selection", () => {
  // Three rack sounds in RACK order — kick 36, snare 38, hat 42 — over four one-beat steps.
  const rowNotes = [36, 38, 42];
  const cells = [0, 1, 2, 3];
  const byCell = notesByCell(
    [note(0, 36), { ...note(1.25, 38), vel: 0.5 }, note(3, 42)],
    0,
    4,
    1,
  );
  const plan = (
    box: [number, number, number, number],
    dRow: number,
    dCol: number,
  ) =>
    planSelectionMove({
      box: { rowLo: box[0], rowHi: box[1], colLo: box[2], colHi: box[3] },
      dRow,
      dCol,
      rowNotes,
      cells,
      byCell,
    });

  it("moves every held note by the same rows and steps, through the RACK's rows, nudge kept", () => {
    // Kick at 0 and snare at 1.25, one row down and one step right: snare at 1, hat at 2.25.
    expect(plan([0, 1, 0, 1], 1, 1)).toEqual({
      moves: [
        [36, 0, 38, 1],
        [38, 1.25, 42, 2.25],
      ],
      // The kick lands on the snare's old pad as the snare leaves it: that pad stays lit.
      lift: ["36@0"],
      land: [{ key: "38@1" }, { key: "42@2", vel: 0.5 }],
    });
  });

  it("shifts a run along its own row, each note landing where the next one leaves", () => {
    const run = notesByCell([note(0, 36), note(1, 36)], 0, 4, 1);
    expect(
      planSelectionMove({
        box: { rowLo: 0, rowHi: 0, colLo: 0, colHi: 1 },
        dRow: 0,
        dCol: 1,
        rowNotes,
        cells,
        byCell: run,
      }),
    ).toEqual({
      moves: [
        [36, 0, 36, 1],
        [36, 1, 36, 2],
      ],
      lift: ["36@0"],
      land: [{ key: "36@1" }, { key: "36@2" }],
    });
  });

  it("refuses leaving the grid, landing on a pad that stays, and an empty rectangle", () => {
    expect(plan([0, 1, 0, 1], 2, 0)).toEqual({ refused: "outside" });
    expect(plan([0, 0, 0, 0], 0, -1)).toEqual({ refused: "outside" });
    // The hat at step 3 stays where it is: the kick cannot land there.
    expect(plan([0, 0, 0, 0], 2, 3)).toEqual({ refused: "occupied" });
    expect(plan([2, 2, 0, 1], 0, 1)).toEqual({ refused: "empty" });
  });
});

describe("deleting a selection", () => {
  // Rack order is not key order: the hat (42) sits between the kick (36) and the snare (38).
  const rowNotes = [36, 42, 38];
  const cells = [0, 1, 2, 3];
  const base = [note(0, 36), note(2.25, 38), note(1, 42), note(3, 42)];
  const plan = (
    box: [number, number, number, number],
    notes: WebNote[] = base,
  ) =>
    planSelectionDelete({
      box: { rowLo: box[0], rowHi: box[1], colLo: box[2], colHi: box[3] },
      rowNotes,
      cells,
      step: 1,
      notes,
    });

  it("takes the notes the box holds, as the range the command reads, and clears their pads", () => {
    expect(plan([0, 1, 0, 1])).toEqual({
      hit: [note(0, 36), note(1, 42)],
      range: { lo: 36, hi: 42, from: 0, to: 2 },
      lift: ["36@0", "42@1"],
    });
  });

  it("refuses when the key range would also take a note on a row outside the box", () => {
    // Kick and hat over beats 0..2: the range 36..42 also holds a snare at 0.5.
    expect(plan([0, 1, 0, 1], [...base, note(0.5, 38)])).toEqual({
      refused: "span",
    });
  });

  it("refuses a box that holds nothing", () => {
    expect(plan([0, 0, 2, 3])).toEqual({ refused: "empty" });
  });
});
