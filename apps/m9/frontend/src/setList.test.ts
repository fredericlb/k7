import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { resolveSet } from "./setList";

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
