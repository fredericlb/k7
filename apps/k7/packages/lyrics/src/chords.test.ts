import { describe, expect, it } from "vitest";
import {
  formatTimecode,
  isTabLine,
  looseChordLine,
  stripTimecodes,
  timecodeOf,
  collectChords,
  isChord,
  parseChordSheet,
  splitChord,
  transposeChord,
  transposeLine,
} from "./chords";

describe("isChord", () => {
  it("accepts common chord spellings", () => {
    for (const c of [
      "C",
      "Am",
      "C#m7",
      "Bb",
      "G/B",
      "Cmaj7",
      "Dsus4",
      "F#m7b5",
      "N.C.",
    ]) {
      expect(isChord(c), c).toBe(true);
    }
  });

  it("rejects ordinary words", () => {
    for (const w of ["Hello", "Verse", "Bad", "Cage", "Fed", "the", "Chorus"]) {
      expect(isChord(w), w).toBe(false);
    }
  });
});

describe("parseChordSheet", () => {
  it("classifies section headers", () => {
    expect(parseChordSheet("[Verse 1]")[0]).toEqual({
      type: "section",
      label: "Verse 1",
    });
    expect(parseChordSheet("(Chorus)")[0]).toEqual({
      type: "section",
      label: "Chorus",
    });
    expect(parseChordSheet("Bridge:")[0]).toEqual({
      type: "section",
      label: "Bridge",
    });
  });

  it("detects a chords-above-lyrics line", () => {
    expect(parseChordSheet("C       G   Am")[0]).toEqual({
      type: "chords",
      text: "C       G   Am",
    });
  });

  it("tokenizes inline bracketed chords", () => {
    const line = parseChordSheet("[C]Hello darkness [G]my old friend")[0];
    expect(line).toEqual({
      type: "lyrics",
      segments: [
        { chord: "C", text: "Hello darkness " },
        { chord: "G", text: "my old friend" },
      ],
    });
  });

  it("leaves plain lyrics untouched", () => {
    expect(parseChordSheet("just some words")[0]).toEqual({
      type: "lyrics",
      segments: [{ chord: null, text: "just some words" }],
    });
  });

  it("treats blank lines as empty", () => {
    expect(parseChordSheet("")[0]).toEqual({ type: "empty" });
  });

  it("honors %c / %t override markers", () => {
    expect(parseChordSheet("A %t")[0]).toEqual({
      type: "lyrics",
      segments: [{ chord: null, text: "A" }],
    });
    expect(parseChordSheet("do re mi %c")[0].type).toBe("chords");
  });
});

describe("transposeChord", () => {
  it("shifts the root and keeps the quality", () => {
    expect(transposeChord("C", 2)).toBe("D");
    expect(transposeChord("Am7", 2)).toBe("Bm7");
    expect(transposeChord("A", -1)).toBe("G#");
  });

  it("prefers flats when the original used a flat", () => {
    expect(transposeChord("Bb", 2)).toBe("C");
    expect(transposeChord("Ab", -1)).toBe("G");
  });

  it("moves the slash-bass note too", () => {
    expect(transposeChord("G/B", 2)).toBe("A/C#");
  });

  it("wraps around the octave", () => {
    expect(transposeChord("B", 1)).toBe("C");
  });

  it("leaves non-chords and zero shifts unchanged", () => {
    expect(transposeChord("Hello", 2)).toBe("Hello");
    expect(transposeChord("C", 0)).toBe("C");
  });
});

describe("transposeLine", () => {
  it("transposes chords while preserving spacing", () => {
    expect(transposeLine("C   G   Am", 2)).toBe("D   A   Bm");
  });
});

describe("splitChord", () => {
  it("splits root, suffix and slash-bass", () => {
    expect(splitChord("C#m7")).toEqual({
      root: "C#",
      suffix: "m7",
      bass: null,
    });
    expect(splitChord("G/B")).toEqual({ root: "G", suffix: "", bass: "B" });
    expect(splitChord("Hello")).toBeNull();
  });
});

describe("collectChords", () => {
  it("gathers unique chords in first-seen order across both formats", () => {
    const text = ["C       G   Am", "[C]hello [G]world [Am]again", "C"].join(
      "\n",
    );
    expect(collectChords(text)).toEqual(["C", "G", "Am"]);
  });

  it("ignores section labels and plain lyrics", () => {
    expect(collectChords("[Chorus]\njust words here")).toEqual([]);
  });
});

describe("timecodes in the text", () => {
  it("are read, written and taken off", () => {
    expect(timecodeOf("Oh sinnerman {{01:05}}")).toBe(65);
    expect(timecodeOf("Oh sinnerman")).toBeNull();
    expect(timecodeOf("{{01:05.63}} Oh sinnerman")).toBeCloseTo(65.63);
    expect(formatTimecode(65.63)).toBe("{{01:05.63}}");
    expect(formatTimecode(6005)).toBe("{{100:05.00}}");
    expect(stripTimecodes("Oh sinnerman {{01:05}}")).toBe("Oh sinnerman");
    // In front, the code takes its space with it: the words stay where they were typed.
    expect(stripTimecodes("{{01:05.63}} Oh sinnerman")).toBe("Oh sinnerman");
    expect(stripTimecodes("  {{01:05.63}} Oh sinnerman")).toBe(
      "  Oh sinnerman",
    );
  });

  it("never show on the sheet, and never turn a lyric into a chord line", () => {
    const [line] = parseChordSheet("{{00:12.50}} Am I blue");
    expect(line).toEqual({
      type: "lyrics",
      segments: [{ chord: null, text: "Am I blue" }],
    });
  });
});

describe("what a hand types that is not lyrics", () => {
  it("tells tablature from a lyric", () => {
    expect(isTabLine("e|-----0-----|")).toBe(true);
    expect(isTabLine("|--3--5--|")).toBe(true);
    expect(isTabLine("I could go - off - the | end")).toBe(false);
  });

  it("reads `C**` as chords with emphasis", () => {
    expect(looseChordLine("C**")).toBe(true);
    expect(looseChordLine("C   G.  Am")).toBe(true);
    expect(looseChordLine("Can I go")).toBe(false);
  });
});
