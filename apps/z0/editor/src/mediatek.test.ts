// The catalogue lookups behind a `song:` address. The variant rule is the one worth pinning:
// it is the loader's, not this editor's, and getting it wrong makes the preview play a
// different file from the one the game will (apps/z0/docs/projects.md).

import { describe, expect, it } from "vitest";
import { audioPath, type Catalogue, label } from "./mediatek";

const ZAZ = "songs/Zaz/Album inconnu/Je veux";
const NOSTEM = "songs/Cake/Album inconnu/I will survive";

const cat: Catalogue = new Map([
  [
    ZAZ,
    {
      id: ZAZ,
      title: "Je veux",
      artist: "Zaz",
      master: "original.flac",
      variants: [
        { name: "stems", ref: "stems.mp3", kind: "file" as const },
        { name: "8bit", ref: "8bit.mp3", kind: "missing" as const },
      ],
    },
  ],
  [
    NOSTEM,
    {
      id: NOSTEM,
      title: "I will survive",
      artist: "Cake",
      master: "original.mp3",
      variants: [],
    },
  ],
  [
    "songs/Vide/Album inconnu/Rien",
    { id: "songs/Vide/Album inconnu/Rien", title: "Rien", variants: [] },
  ],
]);

describe("label", () => {
  it("is artist then title, which is what the .z0 no longer stores", () => {
    expect(label(ZAZ, cat)).toBe("Zaz — Je veux");
  });

  it("falls back to the folder name for a song this médiathèque does not hold", () => {
    // A `.z0` travels in a git repository; the machine opening it may hold a different library.
    expect(label("songs/X/Y/Un titre", cat)).toBe("Un titre");
  });

  it("is empty for a track that names no song", () => {
    expect(label(undefined, cat)).toBe("");
  });
});

describe("audioPath", () => {
  it("is the master when the category asks for no variant", () => {
    expect(audioPath(ZAZ, undefined, cat)).toBe(`${ZAZ}/original.flac`);
  });

  it("is the variant's file when the category asks for one that EXISTS", () => {
    expect(audioPath(ZAZ, "stems", cat)).toBe(`${ZAZ}/stems.mp3`);
  });

  it("falls back to the master when the variant is declared but missing", () => {
    // The thirteen covers whose `original` IS the cover: the game plays them as they are.
    expect(audioPath(ZAZ, "8bit", cat)).toBe(`${ZAZ}/original.flac`);
  });

  it("falls back to the master when the song has no such variant at all", () => {
    expect(audioPath(NOSTEM, "stems", cat)).toBe(`${NOSTEM}/original.mp3`);
  });

  it("is null when the song is catalogued but carries no audio", () => {
    expect(
      audioPath("songs/Vide/Album inconnu/Rien", undefined, cat),
    ).toBeNull();
  });

  it("is null for a song this médiathèque does not hold", () => {
    expect(audioPath("songs/X/Y/Z", undefined, cat)).toBeNull();
  });
});
