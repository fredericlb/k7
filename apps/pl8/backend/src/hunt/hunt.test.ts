import { describe, expect, it } from "vitest";
import { searchTexts } from "./hunt.ts";

describe("searchTexts", () => {
  it("demande l'album et le titre, puis le titre seul", () => {
    expect(searchTexts("Nevermind", "Lithium")).toEqual([
      "Nevermind Lithium",
      "Lithium",
    ]);
  });

  it("ne met JAMAIS l'artiste dans la requête", () => {
    // A Soulseek search covers the whole shared path, and the artist is almost always the folder
    // ABOVE the album: it narrows nothing the album has not already narrowed, and every extra term
    // is one more way to miss a legitimate copy. The artist stays the filter on what comes back —
    // see rankCandidates.
    expect(searchTexts("Nevermind", "Lithium").join(" | ")).not.toContain(
      "Nirvana",
    );
    expect(searchTexts("Kind of Blue", "So What").join(" | ")).not.toContain(
      "Miles",
    );
    // And nothing else either: the two attempts are exactly album+title, then title. A strict
    // equality, because one term too many can only lose copies.
    expect(searchTexts("Kind of Blue", "So What")).toEqual([
      "Kind of Blue So What",
      "So What",
    ]);
  });

  it("ne fait qu'une tentative quand il n'y a pas d'album", () => {
    // Otherwise the same search would go out twice, spending a second round of somebody's
    // patience.
    expect(searchTexts(null, "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts("   ", "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts(undefined, "Lithium")).toEqual(["Lithium"]);
  });

  it("n'a rien à demander sans titre", () => {
    expect(searchTexts("Nevermind", "  ")).toEqual([]);
  });
});
