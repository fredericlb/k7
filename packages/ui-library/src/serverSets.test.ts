import { resolveItems } from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { byFolder, missingUnder, playlistMissing } from "./serverSets";

const song = (path: string): MediatekEntry =>
  ({
    id: path,
    family: "songs",
    path,
    name: path.split("/").pop(),
  }) as MediatekEntry;

const server = [
  song("songs/AC-DC/Back in Black/Shoot to Thrill"),
  song("songs/AC-DC/Back in Black/Hells Bells"),
  song("songs/AC-DC/Highway/Highway to Hell"),
  song("songs/Nirvana/Nevermind/Lithium"),
];

describe("missingUnder", () => {
  it("takes an album's server-only songs, and none of its neighbour's", () => {
    expect(missingUnder(server, "songs/AC-DC/Back in Black")).toEqual([
      "songs/AC-DC/Back in Black/Hells Bells",
      "songs/AC-DC/Back in Black/Shoot to Thrill",
    ]);
  });

  it("takes an artist's albums whole, and does not match a name prefix", () => {
    expect(missingUnder(server, "songs/AC-DC")).toHaveLength(3);
    expect(missingUnder(server, "songs/AC")).toEqual([]);
  });
});

describe("byFolder", () => {
  it("groups by album, in path order", () => {
    expect(
      byFolder(server).map((g) => [g.folder, g.entries.map((e) => e.name)]),
    ).toEqual([
      ["songs/AC-DC/Back in Black", ["Hells Bells", "Shoot to Thrill"]],
      ["songs/AC-DC/Highway", ["Highway to Hell"]],
      ["songs/Nirvana/Nevermind", ["Lithium"]],
    ]);
  });
});

describe("playlistMissing", () => {
  const here = [song("songs/AC-DC/Back in Black/Shoot to Thrill")];

  it("names the lines this machine lacks and the server holds, by path or by name, once", () => {
    const rows = resolveItems(
      [
        { song: "AC-DC/Back in Black/Shoot to Thrill" },
        { song: "AC-DC/Back in Black/Hells Bells" },
        { song: "Lithium", variant: "instru" },
        { song: "Lithium" },
        { song: "Nowhere" },
      ],
      here,
    );
    expect(playlistMissing(rows, server)).toEqual([
      "songs/AC-DC/Back in Black/Hells Bells",
      "songs/Nirvana/Nevermind/Lithium",
    ]);
  });
});
