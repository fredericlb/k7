// LRC lines, and their timecodes written into a chord sheet as `{{MM:SS}}` — the text otherwise untouched.

import { describe, expect, it } from "vitest";
import {
  alignLines,
  hasTimecodes,
  lineAt,
  lineStarts,
  lyricLines,
  normalizeLine,
  parseLrc,
  timecodesByLine,
  timeLyrics,
  timingsByLine,
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

describe("timeLyrics", () => {
  const timed = (lyrics: string, lrc = LRC) => {
    const r = timeLyrics(lyrics, lrc);
    if (!r.ok) throw new Error("no timing");
    return r;
  };

  it("adds {{MM:SS}} to the sheet's lines and changes nothing else", () => {
    const sheet = [
      "[Verse]",
      "      C              G",
      "Oh sinnerman where you gonna run to",
      "Where you gona run to",
      "",
      "All on that day",
    ].join("\n");
    const r = timed(sheet);
    expect(r.lyrics.split("\n")).toEqual([
      "[Verse]",
      "      C              G",
      "Oh sinnerman where you gonna run to {{00:12}}",
      "Where you gona run to {{00:18}}",
      "",
      "All on that day {{00:24}}",
    ]);
    // With the codes taken off, the sheet is exactly what it was.
    expect(r.lyrics.replace(/ \{\{\d+:\d+\}\}/g, "")).toBe(sheet);
    expect([r.placed, r.total]).toEqual([3, 3]);
  });

  it("never times a chord line, a tablature line or a section", () => {
    const sheet = [
      "[Oh sinnerman]",
      "C**",
      "e|---0---2---|",
      "Oh sinnerman where you gonna run to",
    ].join("\n");
    const out = timed(sheet).lyrics.split("\n");
    expect(out.slice(0, 3)).toEqual([
      "[Oh sinnerman]",
      "C**",
      "e|---0---2---|",
    ]);
    expect(out[3]).toBe("Oh sinnerman where you gonna run to {{00:12}}");
  });

  it("keeps the order: a later fetched line never lands above an earlier one's", () => {
    // "All on that day" is written first, but the LRC sings it last: timing it there would put 00:24 above 00:12.
    const sheet =
      "All on that day\nOh sinnerman where you gonna run to\nWhere you gonna run to";
    const out = timed(sheet).lyrics.split("\n");
    expect(out[0]).toBe("All on that day");
    expect(out[1]).toMatch(/\{\{00:12\}\}$/);
    expect(out[2]).toMatch(/\{\{00:18\}\}$/);
  });

  it("times a sheet line the LRC sings as two with the FIRST one's time", () => {
    const lrc =
      "[00:12.00]But I've got an angry heart\n[00:14.00]Filled with cancers and poppy tarts";
    const r = timed(
      "But I've got an angry heart, filled with cancers and poppy tarts.",
      lrc,
    );
    expect(r.lyrics).toBe(
      "But I've got an angry heart, filled with cancers and poppy tarts. {{00:12}}",
    );
    expect(r.placed).toBe(2);
  });

  it("times two sheet lines the LRC sings as one on the first, chords between them or not", () => {
    const lrc =
      "[01:10.00]If we could just get the braves to get out of bed in the morning";
    const sheet =
      "If we could just get the braves to get out of\n              C**\nbed in the morning.";
    expect(timed(sheet, lrc).lyrics.split("\n")).toEqual([
      "If we could just get the braves to get out of {{01:10}}",
      "              C**",
      "bed in the morning.",
    ]);
  });

  it("leaves a line nothing fetched resembles untimed", () => {
    const out = timed(
      "Oh sinnerman where you gonna run to\nsome ad lib nobody wrote down",
    ).lyrics.split("\n");
    expect(out[1]).toBe("some ad lib nobody wrote down");
  });

  it("replaces the codes a sheet already has, rather than piling up", () => {
    const once = timed("Oh sinnerman where you gonna run to").lyrics;
    expect(timed(once).lyrics).toBe(once);
    expect(timed("Oh sinnerman where you gonna run to {{03:33}}").lyrics).toBe(
      once,
    );
  });

  it("writes the fetched lines themselves, timed, when there were no lyrics", () => {
    expect(timed("").lyrics).toBe(
      "Oh sinnerman, where you gonna run to? {{00:12}}\nWhere you gonna run to? {{00:18}}\nAll on that day {{00:24}}",
    );
  });

  it("refuses an LRC with no timed line", () => {
    expect(timeLyrics("la", "no stamps here")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("timecodesByLine", () => {
  it("reads each line's {{MM:SS}}, by line index, and the text needs nothing else", () => {
    const text =
      "[Verse]\nC\nOh sinnerman {{00:12}}\nWhere you gonna run to {{01:05}}";
    expect([...timecodesByLine(text)]).toEqual([
      [2, 12],
      [3, 65],
    ]);
    expect(hasTimecodes(text)).toBe(true);
    expect(hasTimecodes("Oh sinnerman")).toBe(false);
  });

  it("does not let a timecode make a line into something else", () => {
    // Matched and highlighted as the lyric it is; the code is not a word of it.
    expect(lyricLines("Oh sinnerman {{00:12}}")).toEqual([
      { line: 0, text: "oh sinnerman" },
    ]);
  });
});

describe("lineStarts", () => {
  it("starts each line where the timed line before it was sung out", () => {
    // Codes close their lines: 25, 32, 40 → the 2nd line from 25, the 3rd from 32.
    const starts = lineStarts(
      new Map([
        [2, 25],
        [3, 32],
        [5, 40],
      ]),
    );
    expect(starts.get(3)).toBe(25);
    expect(starts.get(5)).toBe(32);
    // The first one, a typical line (the median gap) before its code.
    expect(starts.get(2)).toBe(17);
    // Mid-way through the 2nd line is the 2nd line, not the 1st.
    expect(lineAt(starts, 28)).toBe(3);
  });

  it("never starts before 0, nor after its own code when codes go backwards", () => {
    const starts = lineStarts(
      new Map([
        [0, 3],
        [1, 30],
        [2, 20],
      ]),
    );
    expect(starts.get(0)).toBe(0);
    expect(starts.get(2)).toBe(20);
  });
});

describe("timingsByLine and lineAt", () => {
  it("keeps the times of unchanged lines after an edit, and follows the playhead", () => {
    // Timings stored BESIDE the text, as a song timed before `{{MM:SS}}` has them.
    const lyrics = parseLrc(LRC)
      .map((l) => l.text)
      .join("\n");
    const timings = parseLrc(LRC).map((l, line) => ({
      line,
      text: normalizeLine(l.text),
      t: l.t,
    }));
    const edited = `Intro line\n${lyrics}`.replace(
      "All on that day",
      "All on this day",
    );
    const byLine = timingsByLine(edited, timings);
    expect([...byLine]).toEqual([
      [1, 12.5],
      [2, 18],
    ]);
    expect(lineAt(byLine, 5)).toBeNull();
    expect(lineAt(byLine, 15)).toBe(1);
    expect(lineAt(byLine, 60)).toBe(2);
  });
});
