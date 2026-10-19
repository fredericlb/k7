import { describe, expect, it } from "vitest";
import { seqWindowFromText, windowSpan } from "./seqWindow";

// A sequence's `from`/`to` are TIMECODES and POSITIONS, read from the file's own text (docs/entityFiles.md).

const seq = (head: string) => `${head}\nnotes([{ t: 0, d: 1, k: 60 }])\n`;

describe("what the file states", () => {
  it("reads both edges as beats", () => {
    expect(seqWindowFromText(seq('from("2:1")\nto("4:1")'))).toEqual({
      from: 4,
      to: 12,
    });
  });

  it("leaves `to` null when only `from` is written — the extent is the grid's to know", () => {
    expect(seqWindowFromText(seq('from("2:1")'))).toEqual({
      from: 4,
      to: null,
    });
  });

  it("reads a bare `to` from the first beat", () => {
    expect(seqWindowFromText(seq('to("3:1")'))).toEqual({ from: 0, to: 8 });
  });

  it("says NOTHING when the file states nothing", () => {
    // A window nobody wrote is not a window: it is the whole of the material.
    expect(seqWindowFromText(seq('name("drums")'))).toBeNull();
  });

  it("follows the meter", () => {
    // "2:1" is one bar in, and a bar in 3/4 is three beats.
    expect(seqWindowFromText(seq('from("2:1")'), 3, 4)?.from).toBe(3);
  });
});

describe("what it refuses to guess", () => {
  it("ignores a half-typed edge rather than reading it as 0", () => {
    // This runs on every keystroke, and a band that jumps mid-word is worse than one that waits.
    expect(seqWindowFromText(seq('from("3:")'))).toBeNull();
  });

  it("ignores a SECONDS spelling, which a sequence does not have", () => {
    // A number in a clip means seconds into a file, and SeqEdge refuses it here for that reason.
    expect(seqWindowFromText(seq("from(1.5)"))).toBeNull();
  });

  it("returns null on a document that does not parse", () => {
    expect(seqWindowFromText('from("2:1")\nnotes([')).toBeNull();
  });
});

describe("resolving it against the notes", () => {
  it("fills an absent `to` with the extent", () => {
    expect(windowSpan({ from: 4, to: null }, 16)).toEqual({ from: 4, to: 16 });
  });

  it("keeps a `to` that reaches PAST the notes — the pad is what explains the empty tail", () => {
    expect(windowSpan({ from: 0, to: 32 }, 16)).toEqual({ from: 0, to: 32 });
  });

  it("draws nothing for a span that does not run forwards", () => {
    expect(windowSpan({ from: 8, to: 4 }, 16)).toBeNull();
    expect(windowSpan({ from: 16, to: null }, 16)).toBeNull();
  });
});
