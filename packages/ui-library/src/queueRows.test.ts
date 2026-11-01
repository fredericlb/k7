import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { queueable } from "./queueRows";

const song = (
  path: string,
  meta: MediatekEntry["meta"] = { master: "song.flac" },
): MediatekEntry => ({
  family: "songs",
  id: path,
  name: path.split("/").at(-1) ?? path,
  path,
  kind: "",
  mtime: 0,
  meta,
});

const here = song("songs/Nirvana/Nevermind/Lithium", {
  master: "a.flac",
  track: 5,
});
const there = song("songs/Nirvana/Nevermind/Breed", {
  master: "b.flac",
  track: 4,
});
const empty = song("songs/Nirvana/Nevermind/Demo", {});
const known = [here, there, empty];
const SERVER = "https://app.k7.rocks/api/server";
const baseOf = (e: MediatekEntry) => (e === there ? SERVER : undefined);
const paths = (list: MediatekEntry[]) => list.map((e) => e.path);

describe("queueable", () => {
  it("is the song itself when the row is a song", () => {
    expect(
      paths(queueable(known, "Nirvana/Nevermind/Lithium", baseOf, SERVER)),
    ).toEqual([here.path]);
  });

  it("is an album's songs in track order, those with a master only", () => {
    expect(
      paths(queueable(known, "Nirvana/Nevermind", baseOf, SERVER)),
    ).toEqual([there.path, here.path]);
  });

  it("leaves out the server's songs while their stream is not known", () => {
    expect(
      paths(queueable(known, "Nirvana/Nevermind", baseOf, undefined)),
    ).toEqual([here.path]);
    expect(
      queueable(known, "Nirvana/Nevermind/Breed", baseOf, undefined),
    ).toEqual([]);
  });

  it("takes nothing for a song with no master, nor for an artist above its albums", () => {
    expect(queueable(known, "Nirvana/Nevermind/Demo", baseOf, SERVER)).toEqual(
      [],
    );
    expect(queueable(known, "Nirvana", baseOf, SERVER)).toEqual([]);
  });
});
