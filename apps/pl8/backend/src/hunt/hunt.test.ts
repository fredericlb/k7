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
    // Une recherche Soulseek porte sur tout le chemin partagé, et l'artiste est presque
    // toujours le dossier AU-DESSUS de l'album : il ne restreint rien que l'album n'ait déjà
    // restreint, et chaque terme ajouté est une façon de plus de rater une copie légitime.
    // L'artiste reste le filtre sur ce qui revient — voir rankCandidates.
    expect(searchTexts("Nevermind", "Lithium").join(" | ")).not.toContain(
      "Nirvana",
    );
    expect(searchTexts("Kind of Blue", "So What").join(" | ")).not.toContain(
      "Miles",
    );
    // Et rien d'autre non plus : les deux tentatives sont exactement l'album+titre, puis
    // le titre. Une égalité stricte, parce qu'un terme de trop ne peut que perdre des copies.
    expect(searchTexts("Kind of Blue", "So What")).toEqual([
      "Kind of Blue So What",
      "So What",
    ]);
  });

  it("ne fait qu'une tentative quand il n'y a pas d'album", () => {
    // Sinon la même recherche partirait deux fois, pour dépenser un second tour de la
    // patience de quelqu'un.
    expect(searchTexts(null, "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts("   ", "Lithium")).toEqual(["Lithium"]);
    expect(searchTexts(undefined, "Lithium")).toEqual(["Lithium"]);
  });

  it("n'a rien à demander sans titre", () => {
    expect(searchTexts("Nevermind", "  ")).toEqual([]);
  });
});
