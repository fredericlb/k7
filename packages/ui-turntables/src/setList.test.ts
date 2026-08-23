import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { browseSongs, NO_PLAYLIST, resolveSet, type SetEntry } from "./setList";

// The browser's list comes from the PLAYLIST the surface names — see ../docs/setList.md.

const entry = (
  id: string,
  name: string,
  extra: Partial<MediatekEntry> = {},
): MediatekEntry =>
  ({
    family: "songs",
    id,
    name,
    path: id,
    kind: "",
    meta: { master: "original.wav" },
    ...extra,
  }) as unknown as MediatekEntry;

const CACHE = [
  entry("songs/lemo/mante/danse", "Danse"),
  entry("songs/lemo/mante/aube", "Aube"),
];

/** A playlist naming these refs, in this order. The format is @studio/song/playlist's. */
const playlist = (...refs: string[]) =>
  `title: Set\nitems:\n${refs.map((r) => `  - ${r}\n`).join("")}`;

describe("the song browser's list", () => {
  const song = (artist: string, name: string): SetEntry => ({
    ref: `${artist}/x/${name}`,
    id: `songs/${artist}/x/${name}`,
    name,
    artist,
    file: "original.wav",
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
    // `Alizée` between `Alain` and `Daft` — comparing code points files every accent after Z.
    const order = browseSongs(LIBRARY, "").map((s) => s.artist);
    expect(order.indexOf("Alizée")).toBeGreaterThan(
      order.indexOf("Alain Bashung"),
    );
    expect(order.indexOf("Alizée")).toBeLessThan(order.indexOf("Daft Punk"));
  });

  it("finds an accented name typed without accents", () => {
    // What decides whether the search is usable at a desk: nobody composes an é mid-set.
    expect(browseSongs(LIBRARY, "alizee").map((s) => s.name)).toEqual([
      "Moi Lolita",
    ]);
    expect(browseSongs(LIBRARY, "rose").map((s) => s.name)).toEqual(["Rosé"]);
  });

  it("matches terms in ANY order, across artist and title", () => {
    // `bashung nuit` without knowing which field holds which word — neither naive search does this.
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
    // `sort` mutates in place, and the set list is state: it would reorder on every keystroke.
    const before = LIBRARY.map((s) => s.name);
    browseSongs(LIBRARY, "");
    expect(LIBRARY.map((s) => s.name)).toEqual(before);
  });
});

describe("a playlist resolved against the cache", () => {
  it("pairs each line with its catalogued song, and finds its audio", () => {
    const set = resolveSet(playlist("lemo/mante/danse"), CACHE);
    expect(set.issues).toEqual([]);
    expect(set.entries.map((e) => [e.name, !!e.entry, e.file])).toEqual([
      ["Danse", true, "original.wav"],
    ]);
  });

  it("keeps a song the cache has not got, and names it from its ref", () => {
    const set = resolveSet(playlist("lemo/mante/hiver"), CACHE);
    expect(set.entries.length).toBe(1);
    expect(set.entries[0].entry).toBe(null);
    // The folder the médiathèque filed it under is the best name available before the sync.
    expect(set.entries[0].name).toBe("hiver");
    // …and the id the sync WILL file it under: the ref has no family, the id carries it.
    expect(set.entries[0].id).toBe("songs/lemo/mante/hiver");
    expect(set.entries[0].file).toBe(null);
  });

  it("resolves a line that names a song by its bare title", () => {
    // Only the catalogue knows the path, so the id comes off the resolved entry — see `entryOf`.
    const set = resolveSet(playlist("Danse"), CACHE);
    expect(set.entries[0].id).toBe("songs/lemo/mante/danse");
    expect(set.entries[0].entry).not.toBeNull();
  });

  it("plays the VARIANT a line asks for, not the master", () => {
    // The regression this guards: reading `meta.master` directly can only ever play the original.
    const withVariant = entry("songs/lemo/mante/danse", "Danse", {
      variants: [{ name: "instrumental", ref: "instru.wav", kind: "file" }],
    } as Partial<MediatekEntry>);
    const set = resolveSet(
      "items:\n  - song: lemo/mante/danse\n    variant: instrumental\n",
      [withVariant],
    );
    expect(set.entries[0].variant).toBe("instrumental");
    expect(set.entries[0].file).toBe("instru.wav");
  });

  it("keeps a line whose variant the folder has not got, with nothing to play", () => {
    const set = resolveSet(
      "items:\n  - song: lemo/mante/danse\n    variant: nope\n",
      CACHE,
    );
    expect(set.entries.length).toBe(1);
    expect(set.entries[0].file).toBe(null);
  });

  it("finds an artist for the vinyl label, tags or no tags", () => {
    const tagged = resolveSet(playlist("lemo/mante/danse"), [
      { ...CACHE[0], meta: { artist: "Lemo Mante" } } as MediatekEntry,
    ]);
    expect(tagged.entries[0].artist).toBe("Lemo Mante");

    // No cache entry means no tags: the id's second segment is the artist FOLDER, not a guess.
    const untagged = resolveSet(
      playlist("'Alain Bashung/Album inconnu/La nuit je mens'"),
      [],
    );
    expect(untagged.entries[0].artist).toBe("Alain Bashung");
    expect(untagged.entries[0].name).toBe("La nuit je mens");
  });

  it("drops a song the playlist names twice", () => {
    // A browser, not a document: two identical rows are two chances to pick the same record.
    const set = resolveSet(
      playlist("lemo/mante/danse", "lemo/mante/danse"),
      CACHE,
    );
    expect(set.entries.map((e) => e.id)).toEqual(["songs/lemo/mante/danse"]);
  });

  it("keeps a master and its variant apart", () => {
    // The variant is part of the identity: folding these by ref would drop one of two records.
    const withVariant = entry("songs/lemo/mante/danse", "Danse", {
      variants: [{ name: "instrumental", ref: "instru.wav", kind: "file" }],
    } as Partial<MediatekEntry>);
    const set = resolveSet(
      "items:\n  - lemo/mante/danse\n  - song: lemo/mante/danse\n    variant: instrumental\n",
      [withVariant],
    );
    expect(set.entries.map((e) => e.file)).toEqual([
      "original.wav",
      "instru.wav",
    ]);
  });

  it("reports a playlist that will not read, and draws no songs", () => {
    const set = resolveSet("items: [\n", CACHE);
    expect(set.entries).toEqual([]);
    expect(set.issues.length).toBe(1);
    expect(set.absent).toBe(false);
  });

  it("tells a playlist that is MISSING from one that is empty", () => {
    // Three states, three sentences, and the fix differs each time — see ../docs/setList.md.
    const missing = resolveSet(null, CACHE);
    expect(missing.entries).toEqual([]);
    expect(missing.absent).toBe(false);
    expect(missing.issues.length).toBe(1);

    const empty = resolveSet("items: []\n", CACHE);
    expect(empty.entries).toEqual([]);
    expect(empty.absent).toBe(false);
    expect(empty.issues).toEqual([]);

    expect(NO_PLAYLIST.absent).toBe(true);
    expect(NO_PLAYLIST.issues).toEqual([]);
  });
});
