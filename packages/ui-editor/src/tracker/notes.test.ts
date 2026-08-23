import { describe, expect, it } from "vitest";
import { findNotesArray, type Note, parseNotes, renderNotes } from "./notes";

// The seam both grids edit through: a drag replaces the notes SPAN, so a byte either side eats a neighbouring field.

describe("parseNotes", () => {
  it("reads the {t,d,k,v} shape, in the block form files are written in", () => {
    expect(
      parseNotes(`- { t: 0, d: 1, k: 60, v: 0.8 }
  - { t: 1, d: 0.5, k: 62 }`),
    ).toEqual([
      { t: 0, d: 1, k: 60, v: 0.8 },
      { t: 1, d: 0.5, k: 62 },
    ]);
  });

  it("reads a flow list too — one line is legal and a person may write it", () => {
    expect(parseNotes("[{ t: 0, d: 1, k: 60 }]")).toEqual([
      { t: 0, d: 1, k: 60 },
    ]);
  });

  it("ignores a note missing a required field (t/d/k)", () => {
    expect(parseNotes("- { t: 0, d: 1 }")).toEqual([]); // no k
  });

  it("returns nothing rather than guessing when the span doesn't parse", () => {
    expect(parseNotes("- { t: 0, d:")).toEqual([]);
  });
});

describe("renderNotes", () => {
  it("renders [] for no notes and omits an undefined velocity", () => {
    expect(renderNotes([])).toBe("[]");
    expect(renderNotes([{ t: 0, d: 1, k: 60 }])).not.toContain("v:");
  });

  it("rounds the key to an integer", () => {
    expect(renderNotes([{ t: 0, d: 1, k: 60.4 }])).toContain("k: 60");
  });

  it("indents every line but the first — the first replaces text that was already indented", () => {
    const out = renderNotes(
      [
        { t: 0, d: 1, k: 60 },
        { t: 1, d: 1, k: 62 },
      ],
      "    ",
    );
    const [first, second] = out.split("\n");
    expect(first.startsWith("- ")).toBe(true);
    expect(second.startsWith("    - ")).toBe(true);
  });
});

describe("parseNotes ∘ renderNotes round-trip", () => {
  it("is identity for representative notes", () => {
    const notes: Note[] = [
      { t: 0, d: 1, k: 60, v: 0.8 },
      { t: 1.5, d: 0.25, k: 67 },
      { t: 2, d: 2, k: 48, v: 0.333333 },
    ];
    expect(parseNotes(renderNotes(notes))).toEqual(notes);
  });
});

describe("findNotesArray", () => {
  it("spans the list's items, and the replacement round-trips", () => {
    const doc =
      "notes:\n  - { t: 0, d: 1, k: 60 }\n  - { t: 1, d: 1, k: 62 }\n";
    const span = findNotesArray(doc)!;
    expect(parseNotes(doc.slice(span.from, span.to))).toEqual([
      { t: 0, d: 1, k: 60 },
      { t: 1, d: 1, k: 62 },
    ]);
    // Splicing the same notes back in leaves the document as it was, so a no-op interaction produces no diff.
    const same =
      doc.slice(0, span.from) +
      renderNotes(parseNotes(doc.slice(span.from, span.to)), span.indent) +
      doc.slice(span.to);
    expect(same).toBe(doc);
  });

  it("reports the file's own indentation, not an assumed one", () => {
    const doc = "notes:\n    - { t: 0, d: 1, k: 60 }\n";
    expect(findNotesArray(doc)!.indent).toBe("    ");
  });

  it("does not reach past the list into what follows it", () => {
    const doc = "notes:\n  - { t: 0, d: 1, k: 60 }\nuse_rack: drums\n";
    const span = findNotesArray(doc)!;
    expect(doc.slice(span.from, span.to)).not.toContain("use_rack");
  });

  it("is null when there is no notes list", () => {
    expect(findNotesArray("source: x.wav\n")).toBeNull();
  });

  it("is null while the file doesn't parse, rather than guessing at a span", () => {
    // Mid-keystroke: a guessed span would have the next transaction write into the wrong range.
    expect(findNotesArray("notes:\n  - { t: 0, d:")).toBeNull();
  });
});
