import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import { bytes, entryAt, isSongFolder, treeOf } from "./libraryTree";

const entry = (family: string, path: string): MediatekEntry =>
  ({ id: path, family, path, name: path.split("/").pop() }) as MediatekEntry;

describe("treeOf", () => {
  it("folds a sample into its folders, family segment dropped", () => {
    const tree = treeOf([entry("samples", "samples/drums/kick.wav")], []);
    expect(tree).toEqual([
      {
        name: "drums",
        path: "drums",
        dir: true,
        children: [{ name: "kick.wav", path: "drums/kick.wav" }],
      },
    ]);
  });

  it("keeps a SONG folder-shaped, so it can take a dropped variant", () => {
    const [artist] = treeOf([entry("songs", "songs/A/B/T")], []);
    expect(artist.children?.[0].children?.[0]).toEqual({
      name: "T",
      path: "A/B/T",
      dir: true,
      children: [],
    });
  });

  it("files what no entry accounts for first, so a later entry finds its folder", () => {
    const tree = treeOf(
      [entry("samples", "samples/loose/a.wav")],
      ["loose", "loose/notes.txt"],
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].children?.map((n) => n.name)).toEqual([
      "notes.txt",
      "a.wav",
    ]);
  });
});

describe("the way back from a row", () => {
  const entries = [
    entry("songs", "songs/A/B/T"),
    entry("samples", "samples/A/B/T"),
  ];

  it("finds the entry by its family-relative path", () => {
    expect(entryAt(entries, "A/B/T")?.family).toBe("songs");
  });

  it("calls a row a song only when a song entry sits there", () => {
    expect(isSongFolder(entries, "A/B/T")).toBe(true);
    expect(isSongFolder(entries, "A/B")).toBe(false);
    expect(isSongFolder(entries, "")).toBe(false);
  });
});

it("prints sizes the way the rows do", () => {
  expect([
    bytes(undefined),
    bytes(900),
    bytes(2048),
    bytes(3 * 1024 * 1024),
  ]).toEqual(["", "900 B", "2 kB", "3.0 MB"]);
});
