import { describe, expect, it } from "vitest";
import {
  findSong,
  itemLabel,
  itemProblem,
  resolveItems,
  songMatches,
  songRef,
} from "./playlistItems.ts";
import type { MediatekEntry } from "./types.ts";

const song = (
  path: string,
  extra: Partial<MediatekEntry> = {},
): MediatekEntry => ({
  family: "songs",
  id: `songs/${path}`,
  name: path.split("/").pop() as string,
  path: `songs/${path}`,
  kind: "",
  mtime: 0,
  meta: { catalogued: true, master: "original.wav" },
  ...extra,
});

const HELLS = song("AC-DC/Back in Black/Hells Bells");
const LITHIUM = song("Nirvana/Nevermind/Lithium", {
  variants: [
    { name: "instrumental", ref: "instrumental.wav", kind: "file" },
    { name: "sans-voix", ref: "blindtest/vocal-strip", kind: "missing" },
  ],
});
const LIBRARY = [HELLS, LITHIUM];

describe("findSong", () => {
  it("matches the full path before the bare name", () => {
    expect(findSong("AC-DC/Back in Black/Hells Bells", LIBRARY)).toBe(HELLS);
    expect(findSong("songs/Nirvana/Nevermind/Lithium", LIBRARY)).toBe(LITHIUM);
    // The short form stays available, because it is what anyone actually types.
    expect(findSong("Lithium", LIBRARY)).toBe(LITHIUM);
    expect(findSong("nothing here", LIBRARY)).toBeUndefined();
  });
});

describe("resolveItems", () => {
  it("takes the master when a line names no variant", () => {
    const [r] = resolveItems([{ song: "Hells Bells" }], LIBRARY);
    expect(r.song).toBe(HELLS);
    expect(r.take).toEqual({
      name: "Original",
      kind: "master",
      file: "original.wav",
    });
    expect(itemProblem(r, true)).toBe("");
  });

  it("takes the named variant, and knows a file one from a chain one", () => {
    const [file, chain] = resolveItems(
      [
        { song: "Lithium", variant: "instrumental" },
        { song: "Lithium", variant: "sans-voix" },
      ],
      LIBRARY,
    );
    expect(file.take).toMatchObject({ kind: "file", file: "instrumental.wav" });
    // A chain variant is audio only once rendered — no file here, and no problem either: the
    // pane probes the library for the render rather than refusing on these two lists alone.
    expect(chain.take).toMatchObject({ kind: "missing", file: null });
    expect(itemProblem(chain, true)).toBe("");
  });

  it("keeps a line that resolves to nothing, rather than hiding a typo", () => {
    const [missing, noVariant] = resolveItems(
      [{ song: "Lithuim" }, { song: "Lithium", variant: "acoustique" }],
      LIBRARY,
    );
    expect(missing.song).toBeNull();
    expect(itemProblem(missing, true)).toBe("morceau introuvable");
    // A song that IS there without the version asked for is a different fact, and says so.
    expect(noVariant.song).toBe(LITHIUM);
    expect(noVariant.take).toBeNull();
    expect(itemProblem(noVariant, true)).toBe(
      "variante « acoustique » introuvable",
    );
  });

  it("keeps the playlist's own order — a set list is not a set of songs", () => {
    const order = resolveItems(
      [{ song: "Lithium" }, { song: "Hells Bells" }],
      LIBRARY,
    ).map((r) => r.song?.name);
    expect(order).toEqual(["Lithium", "Hells Bells"]);
  });

  it("reads as unloaded, not as broken, before the songs listing arrives", () => {
    const [r] = resolveItems([{ song: "Hells Bells" }], null);
    expect(r.song).toBeNull();
    expect(itemProblem(r, false)).toBe("morceaux pas encore chargés");
  });

  it("says when a catalogued song carries no audio", () => {
    const empty = song("Nobody/Filed/This", { meta: { catalogued: true } });
    const [r] = resolveItems([{ song: "This" }], [empty]);
    expect(itemProblem(r, true)).toBe("ce morceau n'a pas de master");
  });
});

describe("itemLabel", () => {
  it("names the morceau, and the version when it is not the master", () => {
    const [master, variant] = resolveItems(
      [{ song: "Lithium" }, { song: "Lithium", variant: "instrumental" }],
      LIBRARY,
    );
    expect(itemLabel(master)).toBe("Lithium");
    expect(itemLabel(variant)).toBe("Lithium · instrumental");
  });

  it("falls back to what the line SAYS when nothing answers to it", () => {
    // So an unresolved row still reads as the thing you typed, which is what you go and fix.
    const [r] = resolveItems([{ song: "Lithuim" }], LIBRARY);
    expect(itemLabel(r)).toBe("Lithuim");
  });
});

describe("songRef", () => {
  it("writes the unambiguous path, and what it writes reads back", () => {
    // A click means THAT morceau, unlike a title someone typed — so the search writes the
    // form that cannot resolve to a namesake.
    expect(songRef(HELLS)).toBe("AC-DC/Back in Black/Hells Bells");
    // The property that matters: a line this produced finds its own song again.
    expect(findSong(songRef(HELLS), LIBRARY)).toBe(HELLS);
    expect(resolveItems([{ song: songRef(LITHIUM) }], LIBRARY)[0]?.song).toBe(
      LITHIUM,
    );
  });
});

describe("songMatches", () => {
  it("looks in the title, the artist and the path", () => {
    const withArtist = song("Nirvana/Nevermind/Lithium", {
      meta: { catalogued: true, master: "original.wav", artist: "Nirvana" },
    });
    expect(songMatches(withArtist, "lith")).toBe(true); // the title
    expect(songMatches(withArtist, "nirvana")).toBe(true); // the artist
    expect(songMatches(withArtist, "nevermind")).toBe(true); // the album, via the path
    expect(songMatches(withArtist, "pearl jam")).toBe(false);
  });

  it("wants every word, but not in one place", () => {
    // "nirvana lithium" is artist + title — a single substring match over the whole query
    // finds nothing, which is exactly how a search feels broken.
    expect(songMatches(LITHIUM, "nirvana lithium")).toBe(true);
    expect(songMatches(LITHIUM, "nirvana bells")).toBe(false);
  });

  it("matches everything on an empty query, so opening the field shows the library", () => {
    expect(songMatches(HELLS, "")).toBe(true);
    expect(songMatches(HELLS, "   ")).toBe(true);
  });

  it("ignores case, which is the only way a typed search is usable", () => {
    expect(songMatches(HELLS, "HELLS bells")).toBe(true);
  });
});
