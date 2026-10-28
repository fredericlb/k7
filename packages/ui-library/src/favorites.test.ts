import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { isAlbumFolder, isFavorite } from "./favorites";

const song = (path: string): MediatekEntry =>
  ({
    id: path,
    family: "songs",
    path,
    name: path.split("/").pop(),
  }) as MediatekEntry;

const entries = [
  song("songs/A/Album1/T1"),
  song("songs/A/Album1/T2"),
  song("songs/A/Album2/T3"),
  song("songs/B/Album3/T4"),
];

describe("isFavorite", () => {
  it("covers a song starred itself, or through its album", () => {
    const favs = new Set(["songs/A/Album1", "songs/B/Album3/T4"]);
    expect(isFavorite(favs, "songs/A/Album1/T1")).toBe(true);
    expect(isFavorite(favs, "songs/B/Album3/T4")).toBe(true);
    expect(isFavorite(favs, "songs/A/Album2/T3")).toBe(false);
  });

  it("does not take a name that merely starts the same", () => {
    expect(isFavorite(new Set(["songs/A/Album"]), "songs/A/Album1/T1")).toBe(
      false,
    );
  });
});

describe("isAlbumFolder", () => {
  it("is a folder directly holding a song, never an artist nor a song", () => {
    expect(isAlbumFolder(entries, "A/Album1")).toBe(true);
    expect(isAlbumFolder(entries, "A")).toBe(false);
    expect(isAlbumFolder(entries, "A/Album1/T1")).toBe(false);
    expect(isAlbumFolder(entries, "")).toBe(false);
  });
});
