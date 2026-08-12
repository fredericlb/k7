import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { browseSongs, resolveSet, type SetEntry } from "./setList";

// Mix is about the PROJECT now, so this is the function that decides what it draws. The case
// worth pinning is the third state: a song the set names and the cache has not got. It is
// ordinary — the sync fetches what the open project names, so a set edited a minute ago is
// briefly ahead of the disk — and a list that quietly dropped it would look like a set that
// never had it.

const entry = (id: string, name: string): MediatekEntry =>
  ({
    family: "songs",
    id,
    name,
    path: id,
    kind: "",
    meta: { master: "original.wav" },
  }) as unknown as MediatekEntry;

const CACHE = [
  entry("songs/lemo/mante/danse", "Danse"),
  entry("songs/lemo/mante/aube", "Aube"),
];

describe("the song browser's list", () => {
  const song = (artist: string, name: string): SetEntry => ({
    ref: `@mediatek/songs/${artist}/x/${name}`,
    id: `songs/${artist}/x/${name}`,
    name,
    artist,
    entry: null,
  });

  const LIBRARY = [
    song("Daft Punk", "Around the world"),
    song("Alizée", "Moi Lolita"),
    song("Alain Bashung", "La nuit je mens"),
    song("Alain Bashung", "Ma petite entreprise"),
    song("& Feduk", "Rosé"),
  ];

  it("sorts by artist, then by title", () => {
    expect(
      browseSongs(LIBRARY, "").map((s) => `${s.artist} — ${s.name}`),
    ).toEqual([
      "& Feduk — Rosé",
      "Alain Bashung — La nuit je mens",
      "Alain Bashung — Ma petite entreprise",
      "Alizée — Moi Lolita",
      "Daft Punk — Around the world",
    ]);
  });

  it("files an accented artist where a reader looks for it", () => {
    // `Alizée` between `Alain` and `Daft`. Comparing code points would file every accented
    // artist after Z, which is where half this médiathèque would go.
    const order = browseSongs(LIBRARY, "").map((s) => s.artist);
    expect(order.indexOf("Alizée")).toBeGreaterThan(
      order.indexOf("Alain Bashung"),
    );
    expect(order.indexOf("Alizée")).toBeLessThan(order.indexOf("Daft Punk"));
  });

  it("finds an accented name typed without accents", () => {
    // The case that decides whether the search is usable at a desk: nobody stops to compose
    // an é mid-set.
    expect(browseSongs(LIBRARY, "alizee").map((s) => s.name)).toEqual([
      "Moi Lolita",
    ]);
    expect(browseSongs(LIBRARY, "rose").map((s) => s.name)).toEqual(["Rosé"]);
  });

  it("matches terms in ANY order, across artist and title", () => {
    // `bashung nuit` without knowing which field holds which word — a single substring over
    // the joined string could not do this, and one field at a time could not either.
    expect(browseSongs(LIBRARY, "bashung nuit").map((s) => s.name)).toEqual([
      "La nuit je mens",
    ]);
    expect(browseSongs(LIBRARY, "nuit bashung").map((s) => s.name)).toEqual([
      "La nuit je mens",
    ]);
  });

  it("filters the WHOLE list, not the page", () => {
    expect(browseSongs(LIBRARY, "bashung")).toHaveLength(2);
    expect(browseSongs(LIBRARY, "  ")).toHaveLength(LIBRARY.length);
    expect(browseSongs(LIBRARY, "zzz")).toEqual([]);
  });

  it("leaves the caller's array alone", () => {
    // `sort` mutates in place, and the set list is state — sorting it would reorder the
    // middle pane every time somebody typed a letter.
    const before = LIBRARY.map((s) => s.name);
    browseSongs(LIBRARY, "");
    expect(LIBRARY.map((s) => s.name)).toEqual(before);
  });
});

describe("a set list resolved against the cache", () => {
  it("pairs each ref with its catalogued song", () => {
    const set = resolveSet(
      'songs:\n  - "@mediatek/songs/lemo/mante/danse"\n',
      CACHE,
    );
    expect(set.issues).toEqual([]);
    expect(set.entries.map((e) => [e.name, !!e.entry])).toEqual([
      ["Danse", true],
    ]);
  });

  it("keeps a song the cache has not got, and names it from its id", () => {
    const set = resolveSet(
      'songs:\n  - "@mediatek/songs/lemo/mante/hiver"\n',
      CACHE,
    );
    expect(set.entries.length).toBe(1);
    expect(set.entries[0].entry).toBe(null);
    // The folder the médiathèque filed it under is the best name available before the sync.
    expect(set.entries[0].name).toBe("hiver");
    expect(set.entries[0].ref).toBe("@mediatek/songs/lemo/mante/hiver");
  });

  it("finds an artist for the vinyl label, tags or no tags", () => {
    const tagged = resolveSet(
      'songs:\n  - "@mediatek/songs/lemo/mante/danse"\n',
      [{ ...CACHE[0], meta: { artist: "Lemo Mante" } } as MediatekEntry],
    );
    expect(tagged.entries[0].artist).toBe("Lemo Mante");

    // Not in the cache, so there are no tags to read: the id's second segment is the artist
    // FOLDER the médiathèque filed it under, which is a fact and not a guess.
    const untagged = resolveSet(
      'songs:\n  - "@mediatek/songs/Alain Bashung/Album inconnu/La nuit je mens"\n',
      [],
    );
    expect(untagged.entries[0].artist).toBe("Alain Bashung");
    expect(untagged.entries[0].name).toBe("La nuit je mens");
  });

  it("draws the set in one order whatever the file's line order was", () => {
    const set = resolveSet(
      'songs:\n  - "@mediatek/songs/lemo/mante/danse"\n  - "@mediatek/songs/lemo/mante/aube"\n',
      CACHE,
    );
    expect(set.entries.map((e) => e.id)).toEqual([
      "songs/lemo/mante/aube",
      "songs/lemo/mante/danse",
    ]);
  });

  it("reports a set list that will not read, and draws no songs", () => {
    const set = resolveSet("songs:\n  - not-a-ref\n", CACHE);
    expect(set.entries).toEqual([]);
    expect(set.issues.length).toBe(1);
    expect(set.absent).toBe(false);
  });

  it("tells an empty set list from a set that has none", () => {
    // Written on purpose, against never written at all — one is a set being built, the other
    // is an l8 song opened here or a project from before songs.yaml existed.
    const empty = resolveSet("songs: []\n", CACHE);
    expect(empty.entries).toEqual([]);
    expect(empty.absent).toBe(false);
  });
});
