import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { type AlbumRow, albumOf, songTable } from "./songTable";

const song = (
  path: string,
  meta: MediatekEntry["meta"] = {},
): MediatekEntry => ({
  family: "songs",
  id: path,
  name: path.split("/").at(-1) ?? path,
  path,
  kind: "",
  mtime: 0,
  meta,
});

const none = new Set<string>();

describe("albumOf", () => {
  it("is the artist and album folders, never the unknown album", () => {
    expect(albumOf("Nirvana/Nevermind/Lithium")).toBe("Nirvana/Nevermind");
    expect(albumOf("Nirvana/Album inconnu/Lithium")).toBeNull();
    expect(albumOf("Lithium")).toBeNull();
  });
});

describe("songTable", () => {
  const entries = [
    song("songs/Nirvana/Nevermind/Lithium", { track: 5 }),
    song("songs/Nirvana/Nevermind/Polly", { track: 6 }),
    song("songs/Nirvana/Nevermind/Breed", { track: 4 }),
    song("songs/Nirvana/Bleach/Negative Creep"),
    song("songs/Adele/Album inconnu/Hello"),
    song("songs/Adele/Album inconnu/Skyfall"),
  ];

  it("folds an album of several songs into one row, in track order", () => {
    const [others] = songTable(entries, [], none, none);
    expect(others?.id).toBe("others");
    const album = others?.rows.find((r) => r.kind === "album") as AlbumRow;
    expect(album.rel).toBe("Nirvana/Nevermind");
    expect(album.songs.map((s) => s.title)).toEqual([
      "Breed",
      "Lithium",
      "Polly",
    ]);
  });

  it("keeps a lone album song and the unknown album's songs as songs", () => {
    const [others] = songTable(entries, [], none, none);
    const songs = others?.rows.filter((r) => r.kind === "song") ?? [];
    expect(songs.map((r) => r.title).sort()).toEqual([
      "Hello",
      "Negative Creep",
      "Skyfall",
    ]);
  });

  it("puts practice first, then favorites, then the rest, each sorted by artist then title", () => {
    const groups = songTable(
      entries,
      [],
      new Set(["songs/Nirvana/Nevermind/Polly"]),
      new Set(["songs/Adele/Album inconnu/Skyfall", "songs/Nirvana/Nevermind"]),
    );
    expect(groups.map((g) => g.id)).toEqual([
      "practice",
      "favorites",
      "others",
    ]);
    // The album is practised through one of its songs, so it is not also a favorite.
    expect(groups[0]?.rows.map((r) => r.title)).toEqual(["Nevermind"]);
    expect(groups[1]?.rows.map((r) => r.title)).toEqual(["Skyfall"]);
    expect(groups[2]?.rows.map((r) => r.title)).toEqual([
      "Hello",
      "Negative Creep",
    ]);
  });

  it("files the server's songs among these, and a path here wins", () => {
    const [others] = songTable(
      [song("songs/A/X/One")],
      [song("songs/A/X/One"), song("songs/A/X/Two")],
      none,
      none,
    );
    const album = others?.rows[0] as AlbumRow;
    expect(album.songs.map((s) => [s.title, s.remote])).toEqual([
      ["One", false],
      ["Two", true],
    ]);
    expect(album.remote).toBe(false);
  });

  it("reads the album and artist from the tags when they are there", () => {
    const [others] = songTable(
      [
        song("songs/ac-dc/back/Hells", {
          artist: "AC/DC",
          album: "Back in Black",
        }),
      ],
      [],
      none,
      none,
    );
    expect(others?.rows[0]).toMatchObject({
      artist: "AC/DC",
      album: "Back in Black",
    });
  });
});
