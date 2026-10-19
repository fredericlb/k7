import { parse } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { readSequence, writeNotes } from "./notes";

// The seam both grids edit through: what they read off a sequence's k7x, and the text a grid edit hands back.

const SEQ = [
  "// a bar of melody",
  'use_rack("drums")',
  "notes([",
  "  t(0).d(1).k(60).v(0.8),",
  "  t(1).d(0.5).k(62),",
  "])",
  "",
].join("\n");

describe("readSequence", () => {
  it("reads the notes and the rack the sequence names", () => {
    expect(readSequence(SEQ)).toEqual({
      notes: [
        { t: 0, d: 1, k: 60, v: 0.8 },
        { t: 1, d: 0.5, k: 62 },
      ],
      useRack: "drums",
    });
  });

  it("reads the short form, expanded", () => {
    expect(readSequence('notes("c4 d4")\n')?.notes).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 62 },
    ]);
  });

  it("skips a note missing a required field (t/d/k)", () => {
    expect(readSequence("notes([t(0).d(1)])\n")?.notes).toEqual([]);
  });

  it("is null when there is no notes list, or the text does not read", () => {
    expect(readSequence('source("x.wav")\n')).toBeNull();
    expect(readSequence("notes([t(0).d(\n")).toBeNull();
  });
});

describe("writeNotes", () => {
  it("leaves the text as it was when the notes did not change", () => {
    const same = readSequence(SEQ)?.notes ?? [];
    expect(writeNotes(SEQ, same)).toBe(SEQ);
  });

  it("changes one line for one note, and keeps the comments and the rack", () => {
    const next = writeNotes(SEQ, [
      { t: 0, d: 1, k: 60, v: 0.8 },
      { t: 1, d: 0.5, k: 64 },
    ]) as string;
    const before = SEQ.split("\n");
    const after = next.split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
    expect(next).toContain("// a bar of melody");
    expect(parse(next).use_rack).toBe("drums");
  });

  it("rounds the key to an integer and the times to the beat grid's precision", () => {
    const next = writeNotes(SEQ, [{ t: 0.1234567, d: 1, k: 60.4 }]) as string;
    expect(parse(next).notes).toEqual([{ t: 0.123457, d: 1, k: 60 }]);
  });

  it("carries a pad's effects to the note it still is", () => {
    const text = "notes([t(0).d(1).k(36).repeat(2), t(1).d(1).k(38)])\n";
    const next = writeNotes(text, [
      { t: 0, d: 1, k: 36 },
      { t: 2, d: 1, k: 38 },
    ]) as string;
    expect(parse(next).notes).toEqual([
      { t: 0, d: 1, k: 36, repeat: 2 },
      { t: 2, d: 1, k: 38 },
    ]);
  });

  it("writes the short form out in full once it no longer says the notes", () => {
    const next = writeNotes('notes("c4 d4")\n', [{ t: 0, d: 1, k: 60 }]);
    expect(parse(next as string).notes).toEqual([{ t: 0, d: 1, k: 60 }]);
  });

  it("is null while the text does not read", () => {
    expect(writeNotes("notes([t(0).d(\n", [])).toBeNull();
  });
});
