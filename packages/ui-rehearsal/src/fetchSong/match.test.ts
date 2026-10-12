// Matching a songbook song to pl8's library, where tags differ by accents, case and punctuation.

import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { findLibrarySong, masterPath, matches, songAtPath } from "./match";

const song = (
  path: string,
  name: string,
  artist: string,
  // Null is a song whose scan found no master: the one shape this must skip.
  master: string | null = "original.flac",
): MediatekEntry =>
  ({
    family: "songs",
    id: path,
    name,
    path,
    kind: "",
    mtime: 0,
    meta: { catalogued: true, artist, ...(master ? { master } : {}) },
  }) as MediatekEntry;

const library = [
  song("songs/Nina Simone/Pastel Blues/Sinnerman", "Sinnerman", "Nina Simone"),
  song("songs/Beyonce/Lemonade/Hold Up", "Hold Up", "Beyoncé"),
  song("songs/Other/Album/Sinnerman Remix", "Sinnerman (Remix)", "Other"),
  song("songs/Empty/Album/No Master", "No Master", "Empty", null),
];

describe("findLibrarySong", () => {
  it("matches artist and title exactly, ignoring accents, case and punctuation", () => {
    expect(findLibrarySong(library, "beyonce", "HOLD UP!")?.name).toBe(
      "Hold Up",
    );
    expect(findLibrarySong(library, "Nina Simone", "Sinnerman")?.path).toBe(
      "songs/Nina Simone/Pastel Blues/Sinnerman",
    );
  });

  it("falls back to every word being somewhere in the entry", () => {
    expect(findLibrarySong(library, "Other", "Remix")?.name).toBe(
      "Sinnerman (Remix)",
    );
  });

  it("finds the same title by an artist a typo away", () => {
    // The songbook had « José Gonzales », the library « José González »: every word could not be found.
    const withGonzalez = [
      ...library,
      song(
        "songs/Jose Gonzalez/Live at the 9.30 Club Washington/Heartbeats",
        "Heartbeats",
        "José González",
      ),
    ];
    expect(
      findLibrarySong(withGonzalez, "José Gonzales", "Heartbeats")?.path,
    ).toBe("songs/Jose Gonzalez/Live at the 9.30 Club Washington/Heartbeats");
  });

  it("never takes another band's song for a typo, nor another title", () => {
    const cars = [
      ...library,
      song("songs/The Cars/Album/Drive", "Drive", "The Cars"),
    ];
    expect(findLibrarySong(cars, "The Doors", "Drive")).toBeUndefined();
    expect(
      findLibrarySong(library, "Nina Simon", "Sinnerman 2"),
    ).toBeUndefined();
  });

  it("skips a song with no master and answers nothing when nothing fits", () => {
    expect(findLibrarySong(library, "Empty", "No Master")).toBeUndefined();
    expect(findLibrarySong(library, "Nobody", "Nothing")).toBeUndefined();
  });
});

describe("matches", () => {
  it("accepts artist and title equal once normalised, same as the library's exact bar", () => {
    expect(
      matches("Nina Simone", "Sinnerman", "nina simone", "SINNERMAN!"),
    ).toBe(true);
  });

  it("refuses a loose word-overlap hit — a wrong auto-applied lyric is worse than asking", () => {
    expect(matches("Other", "Sinnerman", "Other", "Sinnerman (Remix)")).toBe(
      false,
    );
  });

  it("refuses a different song entirely", () => {
    expect(matches("Nina Simone", "Sinnerman", "Beyoncé", "Hold Up")).toBe(
      false,
    );
  });
});

describe("songAtPath and masterPath", () => {
  it("finds the song from its folder or its master, and names its master", () => {
    const folder = "songs/Nina Simone/Pastel Blues/Sinnerman";
    expect(songAtPath(library, folder)?.name).toBe("Sinnerman");
    expect(songAtPath(library, `${folder}/original.flac`)?.name).toBe(
      "Sinnerman",
    );
    expect(masterPath(library[0])).toBe(`${folder}/original.flac`);
  });
});
