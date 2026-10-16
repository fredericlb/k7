import type { TreeNode } from "@frediverse/ui/file-tree";
import type { MediatekEntry } from "@studio/mediatek/types";
import { describe, expect, it } from "vitest";
import {
  bytes,
  entryAt,
  folderAt,
  isSongFolder,
  remoteRows,
  treeOf,
} from "./libraryTree";

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

// On a paired machine the server's songs are filed in the SAME tree, among those here (../docs/library.md).
describe("the server's entries in the tree", () => {
  const here = [entry("songs", "songs/AC-DC/Highway/Highway to Hell")];
  const there = [
    entry("songs", "songs/AC-DC/Back in Black/Hells Bells"),
    entry("songs", "songs/Nirvana/Nevermind/Lithium"),
  ];

  it("files them under the artist folders this machine already has", () => {
    const [acdc, nirvana] = treeOf(here, [], there);
    expect(acdc.name).toBe("AC-DC");
    expect(acdc.children?.map((n) => n.name)).toEqual([
      "Highway",
      "Back in Black",
    ]);
    expect(nirvana.children?.[0].children?.[0].path).toBe(
      "Nirvana/Nevermind/Lithium",
    );
  });

  it("draws a song held both here and there once", () => {
    const tree = treeOf(here, [], [here[0]]);
    expect(tree[0].children).toHaveLength(1);
  });

  it("says which rows are the server's alone: its songs, and the folders holding nothing else", () => {
    const rows = remoteRows(here, there);
    expect([...rows.entries].sort()).toEqual([
      "AC-DC/Back in Black/Hells Bells",
      "Nirvana/Nevermind/Lithium",
    ]);
    // AC-DC holds a song here, so it is not the server's alone; Back in Black is.
    expect([...rows.folders].sort()).toEqual([
      "AC-DC/Back in Black",
      "Nirvana",
      "Nirvana/Nevermind",
    ]);
  });
});

describe("folderAt", () => {
  it("creates what is missing and hands back the level inside", () => {
    const roots: TreeNode[] = [];
    const level = folderAt(roots, "audio/amp");
    level.push({ name: "module.yaml", path: "audio/amp/module.yaml" });
    expect(roots).toEqual([
      {
        name: "audio",
        path: "audio",
        dir: true,
        children: [
          {
            name: "amp",
            path: "audio/amp",
            dir: true,
            children: [{ name: "module.yaml", path: "audio/amp/module.yaml" }],
          },
        ],
      },
    ]);
  });

  it("reuses a folder it already made", () => {
    const roots: TreeNode[] = [];
    folderAt(roots, "audio/amp");
    folderAt(roots, "audio/fuzz");
    expect(roots).toHaveLength(1);
    expect(roots[0]?.children?.map((n) => n.name)).toEqual(["amp", "fuzz"]);
  });
});
