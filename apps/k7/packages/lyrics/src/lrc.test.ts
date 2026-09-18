// LRC lines, their fuzzy alignment onto a chord sheet, and the refusal of an LRC that is another song.

import { describe, expect, it } from "vitest";
import {
  alignLines,
  alignLrc,
  importLrc,
  lineAt,
  lyricLines,
  normalizeLine,
  parseLrc,
  timingsByLine,
  timingsFrom,
} from "./lrc";

const LRC = `[ar:Nina Simone]
[ti:Sinnerman]
[00:12.50]Oh sinnerman, where you gonna run to?
[00:18.00]Where you gonna run to?
[00:24.25]All on that day
`;

describe("parseLrc", () => {
  it("reads timed lines in order and ignores the header tags", () => {
    expect(parseLrc(LRC)).toEqual([
      { t: 12.5, text: "Oh sinnerman, where you gonna run to?" },
      { t: 18, text: "Where you gonna run to?" },
      { t: 24.25, text: "All on that day" },
    ]);
  });

  it("repeats a line that carries several stamps, and drops word stamps", () => {
    expect(parseLrc("[00:30.00][01:10.00]Chorus <00:30.50>line")).toEqual([
      { t: 30, text: "Chorus line" },
      { t: 70, text: "Chorus line" },
    ]);
  });

  it("applies a positive offset as sooner", () => {
    expect(parseLrc("[offset:+500]\n[00:10.00]Hi")[0].t).toBeCloseTo(9.5);
  });
});

describe("normalizeLine and lyricLines", () => {
  it("compares without accents, case or punctuation", () => {
    expect(normalizeLine("  Où, sont-ils ?! ")).toBe("ou sont ils");
  });

  it("keeps only the sung lines of a chord sheet, chords stripped, by line index", () => {
    const sheet = "[Verse]\nC      G\n[C]Oh sinner[G]man\n\nAll on that day";
    expect(lyricLines(sheet)).toEqual([
      { line: 2, text: "oh sinnerman" },
      { line: 4, text: "all on that day" },
    ]);
  });
});

describe("alignLines", () => {
  it("keeps order, so a repeated chorus pairs with its own occurrence", () => {
    const a = ["verse one", "chorus", "verse two", "chorus"];
    const b = ["verse one", "chorus", "verse two", "chorus"];
    expect(alignLines(a, b, 0.7)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("pairs lines that differ by a typo, and skips lines only one side has", () => {
    const a = ["where you gonna run to", "an extra ad lib", "all on that day"];
    const b = ["where you gona run to", "all on that day"];
    expect(alignLines(a, b, 0.7)).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });
});

describe("importLrc", () => {
  it("becomes the lyrics of a song that has none", () => {
    const result = importLrc("", LRC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics?.split("\n")).toHaveLength(3);
    expect(result.timings.map((t) => [t.line, t.t])).toEqual([
      [0, 12.5],
      [1, 18],
      [2, 24.25],
    ]);
  });

  it("times the lines of existing lyrics it matches, and leaves the rest", () => {
    const lyrics =
      "[Verse]\nOh sinnerman where you gonna run to\n(spoken intro)\nWhere you gona run to\nAll on that day";
    const result = importLrc(lyrics, LRC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics).toBeNull();
    expect(result.timings.map((t) => [t.line, t.t])).toEqual([
      [1, 12.5],
      [3, 18],
      [4, 24.25],
    ]);
  });

  it("refuses an LRC that is another song", () => {
    const result = importLrc("Twinkle twinkle little star\nHow I wonder", LRC);
    expect(result).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("refuses a file with no timed line", () => {
    expect(importLrc("", "just text")).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });
});

describe("alignLrc and timingsFrom", () => {
  // The third line is sung but absent from the LRC: the one a hand pairs afterwards.
  const lyrics =
    "[Verse]\nOh sinnerman where you gonna run to\nsome ad lib nobody wrote down\nWhere you gona run to\nAll on that day";

  it("hands back both sides and what paired by itself, refusing nothing", () => {
    const a = alignLrc(lyrics, LRC);
    expect(a.lrc).toHaveLength(3);
    expect(a.lines.map((l) => l.line)).toEqual([1, 2, 3, 4]);
    expect([...a.pairs]).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ]);
    expect(a.matched).toBe(3);
    expect(a.total).toBe(3);
  });

  it("pairs nothing for another song, and still offers both sides too", () => {
    const a = alignLrc("Twinkle twinkle little star", LRC);
    expect(a.matched).toBe(0);
    expect(a.lrc).toHaveLength(3);
    expect(a.lines).toHaveLength(1);
  });

  it("builds the timecodes of the pairs it is given, in line order", () => {
    const a = alignLrc(lyrics, LRC);
    // The spoken line the automatic pass skipped, paired by hand onto the second LRC line.
    a.pairs.set(1, 1);
    expect(
      timingsFrom(a.lines, a.lrc, a.pairs).map((t) => [t.line, t.t]),
    ).toEqual([
      [1, 12.5],
      [2, 18],
      [3, 18],
      [4, 24.25],
    ]);
  });
});

describe("timingsByLine and lineAt", () => {
  it("keeps the times of unchanged lines after an edit, and follows the playhead", () => {
    const first = importLrc("", LRC);
    if (!first.ok) throw new Error("expected an import");
    const edited = `Intro line\n${first.lyrics}`.replace(
      "All on that day",
      "All on this day",
    );
    const byLine = timingsByLine(edited, first.timings);
    expect([...byLine]).toEqual([
      [1, 12.5],
      [2, 18],
    ]);
    expect(lineAt(byLine, 5)).toBeNull();
    expect(lineAt(byLine, 15)).toBe(1);
    expect(lineAt(byLine, 60)).toBe(2);
  });
});
