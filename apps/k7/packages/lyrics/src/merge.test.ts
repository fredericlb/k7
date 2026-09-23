// mergeLrc: the fetched lyrics are the truth, and the sheet's chords, sections, tablature and notes
// are carried onto them — one rule per test, in the order ../../../docs/lyricsTiming.md gives them.

import { describe, expect, it } from "vitest";
import { lyricLines, timingsByLine } from "./lrc";
import {
  isTabLine,
  mergeLrc,
  moveChords,
  OTHER_SECTION,
  renderChordLine,
} from "./merge";

const LRC = [
  "[00:10.00]I could go off the deep end",
  "[00:14.00]I could stay right here",
  "[00:20.00]Brave as a noun",
  "[00:24.00]Scared as a verb",
].join("\n");

const merged = (sheet: string, lrc = LRC) => {
  const r = mergeLrc(sheet, lrc);
  if (!r.ok) throw new Error("no merge");
  return r;
};
const lines = (sheet: string, lrc = LRC) =>
  merged(sheet, lrc).lyrics.split("\n");

describe("a sheet that is only lyrics", () => {
  it("is replaced by the fetched lyrics, outright", () => {
    const r = merged(
      "i could go off the deep end\nsome other words\n\nbrave as a noun",
    );
    expect(r.report.replaced).toBe(true);
    expect(r.lyrics).toBe(
      "I could go off the deep end\nI could stay right here\nBrave as a noun\nScared as a verb",
    );
    expect(r.timings.map((t) => t.line)).toEqual([0, 1, 2, 3]);
  });
});

describe("chords over the lyrics", () => {
  it("move onto the fetched words they were over, drawn on the line above", () => {
    // The sheet's own spelling differs ("deepend" for "deep end") — the words that are still there carry the chords.
    const sheet = [
      "[Verse]",
      "C           G",
      "I could go off the deepend",
      "Am",
      "I could stay right here",
    ].join("\n");
    const out = lines(sheet);
    const deep = out.indexOf("I could go off the deep end");
    expect(out[deep - 1]).toBe("C           G");
    const stay = out.indexOf("I could stay right here");
    expect(out[stay - 1]).toBe("Am");
  });

  it("reads inline [C] chords too, and draws them the standard way", () => {
    const out = lines("[Verse]\n[C]I could go off the [G]deep end");
    const at = out.indexOf("I could go off the deep end");
    expect(out[at - 1]).toBe("C                  G");
  });

  it("gives a chorus sung again the chords of its first time", () => {
    const lrc = `${LRC}\n[00:30.00]Brave as a noun`;
    const out = lines("[Chorus]\nD\nBrave as a noun", lrc);
    const both = out.flatMap((l, i) => (l === "Brave as a noun" ? [i] : []));
    expect(both).toHaveLength(2);
    for (const i of both) expect(out[i - 1]).toBe("D");
  });
});

describe("different line breaks", () => {
  it("splits a sheet line the fetched lyrics sing as two, each half keeping its chords", () => {
    const lrc =
      "[00:01.00]But I've got an angry heart\n[00:03.00]Filled with cancers and poppy tarts";
    const sheet = [
      "                C                                    Am",
      "But I've got an angry heart, filled with cancers and poppy tarts.",
    ].join("\n");
    expect(lines(sheet, lrc)).toEqual([
      "                C",
      "But I've got an angry heart",
      "                        Am",
      "Filled with cancers and poppy tarts",
    ]);
  });

  it("joins two sheet lines the fetched lyrics sing as one, keeping both lines' chords", () => {
    const lrc =
      "[00:01.00]If we could just get the braves to get out of bed in the morning";
    const sheet = [
      "            Am                     G",
      "If we could just get the braves to get out of",
      "              C**",
      "bed in the morning.",
    ].join("\n");
    expect(lines(sheet, lrc)).toEqual([
      "            Am                     G                        C**",
      "If we could just get the braves to get out of bed in the morning",
    ]);
  });

  it("never joins across a section, nor takes a stray note for half a line", () => {
    // "Capo 2" + the first lyric would read closer to it than nothing — but the lyric alone reads closer still.
    const out = lines("Capo 2\n[Verse]\nC\nI could go off the deep end");
    expect(out[out.length - 1]).toBe("Capo 2");
  });
});

describe("what moves along with the lyrics", () => {
  it("puts a section label before the fetched line its lyric became", () => {
    const sheet = [
      "[Verse]",
      "C",
      "I could go off the deep end",
      "[Chorus]",
      "G",
      "Brave as a noun",
    ].join("\n");
    const out = lines(sheet);
    expect(out.indexOf("[Chorus]")).toBeLessThan(
      out.indexOf("Brave as a noun"),
    );
    expect(out.indexOf("[Chorus]")).toBeGreaterThan(
      out.indexOf("I could stay right here"),
    );
    // A section opens a stanza.
    expect(out[out.indexOf("[Chorus]") - 1]).toBe("");
  });

  it("keeps a line of chords alone, as the sheet wrote it (`C**` included)", () => {
    const out = lines(
      "[Intro]\nC**\n\n[Verse]\nG\nI could go off the deep end",
    );
    expect(out.slice(0, 2)).toEqual(["[Intro]", "C**"]);
    expect(out.indexOf("C**")).toBeLessThan(out.indexOf("[Verse]"));
  });

  it("keeps a tablature block whole, where it stood", () => {
    const tab = ["e|-----0-----|", "B|---1---1---|", "G|-2-------2-|"];
    const sheet = [
      "C",
      "I could go off the deep end",
      ...tab,
      "G",
      "Brave as a noun",
    ].join("\n");
    const out = lines(sheet);
    const at = out.indexOf(tab[0]);
    expect(out.slice(at, at + 3)).toEqual(tab);
    expect(at).toBeGreaterThan(out.indexOf("I could go off the deep end"));
    expect(at).toBeLessThan(out.indexOf("Brave as a noun"));
  });
});

describe("what found no place", () => {
  it("goes under [OTHER CONTENT], at the end, rather than being dropped", () => {
    const sheet = [
      "Capo 2",
      "[Verse]",
      "C",
      "I could go off the deep end",
      "Tabbed by nobody",
    ].join("\n");
    const r = merged(sheet);
    const out = r.lyrics.split("\n");
    const at = out.indexOf(OTHER_SECTION);
    expect(at).toBeGreaterThan(out.indexOf("Scared as a verb"));
    expect(out.slice(at + 1)).toEqual(["Capo 2", "Tabbed by nobody"]);
    expect(r.report.other).toBe(2);
  });

  it("drops a sheet line that is only a VARIANT of the fetched lyrics — they are the truth", () => {
    const out = lines(
      "C\nI could go off the deep end\nG\nBrave az a nown\nextra",
    );
    expect(out).not.toContain("Brave az a nown");
  });
});

describe("the timings", () => {
  it("land on the fetched lines of the new document, and survive being read back", () => {
    const r = merged(
      "[Verse]\nC\nI could go off the deep end\n[Chorus]\nG\nBrave as a noun",
    );
    const out = r.lyrics.split("\n");
    for (const t of r.timings) expect(out[t.line]).toBeDefined();
    expect(r.timings.map((t) => out[t.line])).toEqual([
      "I could go off the deep end",
      "I could stay right here",
      "Brave as a noun",
      "Scared as a verb",
    ]);
    // What the player does with them: every fetched line keeps its time.
    const byLine = timingsByLine(r.lyrics, r.timings);
    expect(byLine.size).toBe(4);
    expect(lyricLines(r.lyrics).length).toBeGreaterThanOrEqual(4);
  });

  it("refuses an LRC with no timed line", () => {
    expect(mergeLrc("C\nla", "no stamps here")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("the pieces", () => {
  it("tells tablature from a lyric", () => {
    expect(isTabLine("e|-----0-----|")).toBe(true);
    expect(isTabLine("|--3--5--|")).toBe(true);
    expect(isTabLine("I could go - off - the | end")).toBe(false);
  });

  it("never lets two chords touch", () => {
    expect(
      renderChordLine([
        { col: 0, text: "Cmaj7" },
        { col: 3, text: "G" },
      ]),
    ).toBe("Cmaj7 G");
  });

  it("keeps a chord past the end of the line that far past the new end", () => {
    expect(moveChords("abc", "abcdef", [{ col: 5, text: "G" }])).toEqual([
      { col: 8, text: "G" },
    ]);
  });
});
