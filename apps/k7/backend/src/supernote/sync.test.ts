// What decides a re-upload. The rest of the sync talks to a server; this part is arithmetic,
// and getting it wrong is either a songbook pushed every hour or one that never updates.

import { describe, expect, it } from "vitest";
import { conflictCopies, songHash } from "./sync.ts";

const song = (over = {}) => ({
  id: "s1",
  artist: "Nina Simone",
  title: "Sinnerman",
  lyrics: "Oh sinnerman",
  tablature: "e|---0---|",
  sheets: [{ id: "f1", name: "score.png", mime: "image/png" }],
  ...over,
});

describe("songHash", () => {
  it("is the same for the same song, whatever else changed", () => {
    expect(songHash(song())).toBe(songHash(song({ favorite: true })));
  });

  for (const [what, over] of [
    ["the words", { lyrics: "changed" }],
    ["the tablature", { tablature: "e|---3---|" }],
    ["the title", { title: "Sinner Man" }],
    ["the artist", { artist: "Nina S." }],
    ["a sheet", { sheets: [] }],
  ] as const) {
    it(`changes when ${what} does`, () => {
      expect(songHash(song(over))).not.toBe(songHash(song()));
    });
  }
});

describe("conflictCopies", () => {
  const ours = ["AJJ - Brave as a noun.epub", "Interpol - Nyc.epub"];
  const entry = (fileName: string, id = fileName) => ({ id, fileName });

  it("finds the copy the server kept of a file we replaced", () => {
    expect(
      conflictCopies(ours, [
        entry("AJJ - Brave as a noun.epub"),
        entry("AJJ - Brave as a noun_CONFLICT_20260907213747770.epub", "x"),
      ]),
    ).toEqual(["x"]);
  });

  it("leaves alone anything that is not a copy of one of ours", () => {
    expect(
      conflictCopies(ours, [
        entry("Notes_CONFLICT_1.epub"),
        entry("AJJ - Brave as a noun.epub"),
        entry("AJJ - Brave as a noun_CONFLICT_.epub"),
        entry("Interpol - Nyc.pdf"),
      ]),
    ).toEqual([]);
  });

  it("does not let a name's punctuation match more than itself", () => {
    expect(
      conflictCopies(
        ["The Verve - The drugs don't work.epub"],
        [entry("The Verve - The drugs donXt work_CONFLICT_1.epub")],
      ),
    ).toEqual([]);
  });
});
