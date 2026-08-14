import { describe, expect, it } from "vitest";
import { seqWindowFromText, windowSpan } from "./seqWindow";

// A sequence's `from`/`to` are TIMECODES and POSITIONS — `"1:1"` is the first beat, `"3:1"` the
// third bar. Read from the file's own text, because the note grids are handed the document.

const seq = (head: string) => `${head}\nnotes:\n  - { t: 0, d: 1, k: 60 }\n`;

describe("what the file states", () => {
  it("reads both edges as beats", () => {
    expect(seqWindowFromText(seq('from: "2:1"\nto: "4:1"'))).toEqual({
      from: 4,
      to: 12,
    });
  });

  it("leaves `to` null when only `from` is written — the extent is the grid's to know", () => {
    expect(seqWindowFromText(seq('from: "2:1"'))).toEqual({
      from: 4,
      to: null,
    });
  });

  it("reads a bare `to` from the first beat", () => {
    expect(seqWindowFromText(seq('to: "3:1"'))).toEqual({ from: 0, to: 8 });
  });

  it("says NOTHING when the file states nothing", () => {
    // Not `{from: 0, to: null}`: a window nobody wrote is not a window, it is the whole material,
    // and a surface that drew it would band every sequence in the project.
    expect(seqWindowFromText(seq("name: drums"))).toBeNull();
  });

  it("follows the meter", () => {
    // "2:1" is one bar in, and a bar in 3/4 is three beats.
    expect(seqWindowFromText(seq('from: "2:1"'), 3, 4)?.from).toBe(3);
  });
});

describe("what it refuses to guess", () => {
  it("ignores a half-typed edge rather than reading it as 0", () => {
    // This runs on every keystroke: a band that jumps to the head of the file between two
    // characters of "3:1" is worse than one that waits.
    expect(seqWindowFromText(seq('from: "3:"'))).toBeNull();
  });

  it("ignores a SECONDS spelling, which a sequence does not have", () => {
    // A number in a clip means seconds into a file; the same spelling meaning beats one folder
    // over is a rule only ever learned by getting it wrong (SeqEdge refuses it too).
    expect(seqWindowFromText(seq("from: 1.5"))).toBeNull();
  });

  it("returns null on a document that does not parse", () => {
    expect(seqWindowFromText("from: [\nnotes:")).toBeNull();
  });

  it("returns null on a document that is not a mapping", () => {
    expect(seqWindowFromText("- one\n- two")).toBeNull();
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
