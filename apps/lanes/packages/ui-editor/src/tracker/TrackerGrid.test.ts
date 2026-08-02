import { describe, expect, it } from "vitest";
import type { Note } from "./notes";
import {
  assignChannels,
  fmtKey,
  keyForOctave,
  placeNote,
  removeNoteAt,
} from "./TrackerGrid";

// The cell (ch,row) each note lands in, for terse assertions.
const cells = (notes: Note[]) => {
  const { cell } = assignChannels(notes);
  return notes.map((n) => cell.get(n)!);
};

describe("assignChannels", () => {
  it("gives at least one channel, even with no notes", () => {
    expect(assignChannels([]).channels).toBe(1);
  });

  it("keeps a non-overlapping melody in a single channel", () => {
    const notes: Note[] = [
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 62 },
      { t: 2, d: 1, k: 64 },
    ];
    const { channels, cell } = assignChannels(notes);
    expect(channels).toBe(1);
    expect(notes.map((n) => cell.get(n)!.ch)).toEqual([0, 0, 0]);
  });

  it("spreads a chord across channels, one voice each", () => {
    const notes: Note[] = [
      { t: 0, d: 1, k: 60 },
      { t: 0, d: 1, k: 64 },
      { t: 0, d: 1, k: 67 },
    ];
    expect(assignChannels(notes).channels).toBe(3);
  });

  it("reuses a channel once its note has ended (abutting is not overlap)", () => {
    const notes: Note[] = [
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 62 }, // starts exactly when the first ends
    ];
    expect(assignChannels(notes).channels).toBe(1);
  });

  it("maps onset time to a step row (a sixteenth = one step)", () => {
    expect(cells([{ t: 1, d: 0.25, k: 60 }])[0]).toEqual({ ch: 0, row: 4 });
  });
});

describe("placeNote", () => {
  it("adds a one-step note at an empty cell", () => {
    const next = placeNote([], 0, 4, 60);
    expect(next).toEqual([{ t: 1, d: 0.25, k: 60 }]);
  });

  it("replaces the pitch of the note in the target cell, keeping its d and v", () => {
    const notes: Note[] = [{ t: 1, d: 0.5, k: 60, v: 0.8 }];
    const next = placeNote(notes, 0, 4, 63);
    expect(next).toEqual([{ t: 1, d: 0.5, k: 63, v: 0.8 }]);
  });

  it("leaves a note in another cell untouched", () => {
    const notes: Note[] = [{ t: 0, d: 0.25, k: 60 }];
    const next = placeNote(notes, 0, 4, 67);
    expect(next).toHaveLength(2);
    expect(next).toContainEqual({ t: 0, d: 0.25, k: 60 });
    expect(next).toContainEqual({ t: 1, d: 0.25, k: 67 });
  });

  it("clamps the pitch into MIDI range", () => {
    expect(placeNote([], 0, 0, 999)[0].k).toBe(127);
    expect(placeNote([], 0, 0, -5)[0].k).toBe(0);
  });
});

describe("removeNoteAt", () => {
  it("removes the note at the cell", () => {
    const notes: Note[] = [{ t: 1, d: 0.25, k: 60 }];
    expect(removeNoteAt(notes, 0, 4)).toEqual([]);
  });

  it("returns the same array (no-op) for an empty cell", () => {
    const notes: Note[] = [{ t: 1, d: 0.25, k: 60 }];
    expect(removeNoteAt(notes, 0, 0)).toBe(notes);
  });
});

describe("fmtKey / keyForOctave", () => {
  it("names middle C as C-4 (MIDI 60)", () => {
    expect(fmtKey(60)).toBe("C-4");
    expect(keyForOctave(4, 0)).toBe(60);
  });

  it("names sharps with a #", () => {
    expect(fmtKey(61)).toBe("C#4");
  });

  it("round-trips an octave's C through keyForOctave", () => {
    expect(fmtKey(keyForOctave(3, 0))).toBe("C-3");
    expect(fmtKey(keyForOctave(5, 0))).toBe("C-5");
  });
});
