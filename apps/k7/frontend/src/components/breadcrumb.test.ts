// breadcrumb.test.ts — the two path spaces the breadcrumb straddles. `Workspace.tree()` moves
// the root of its WALK onto the active project and leaves every path workspace-relative, so a
// menu keyed with an un-stripped path found nothing and every dropdown answered "empty".

import { describe, expect, it } from "vitest";
import type { FileNode } from "../types";
import { childrenOf, dirPrefixes, underRoot } from "./Breadcrumb";

const dir = (name: string, path: string, children: FileNode[]): FileNode => ({
  name,
  path,
  dir: true,
  children,
});
const file = (name: string, path: string): FileNode => ({
  name,
  path,
  dir: false,
  kind: "text",
});

// A project at `songs/first.k7`: the tree's TOP is the song's own children, and their paths still carry the workspace in front.
const ROOT = "songs/first.k7";
const TREE: FileNode[] = [
  dir("modules", `${ROOT}/modules`, [
    dir("io", `${ROOT}/modules/io`, [
      dir("OUT", `${ROOT}/modules/io/OUT`, [
        file("module.yaml", `${ROOT}/modules/io/OUT/module.yaml`),
      ]),
    ]),
  ]),
  file("project.yaml", `${ROOT}/project.yaml`),
];

const OPEN = `${ROOT}/modules/io/OUT/module.yaml`;

describe("underRoot", () => {
  it("strips the project the tree is rooted at", () => {
    expect(underRoot(OPEN, ROOT)).toBe("modules/io/OUT/module.yaml");
  });

  it("is the identity for a lone-project workspace, which is why this survived", () => {
    expect(underRoot("modules/io/OUT/module.yaml", "")).toBe(
      "modules/io/OUT/module.yaml",
    );
  });

  it("answers null for a path OUTSIDE the tree — a library module is not in it", () => {
    expect(underRoot("_libraries/modules/synth/module.yaml", ROOT)).toBeNull();
  });

  it("does not mistake a sibling whose name merely starts the same", () => {
    expect(underRoot("songs/first.k7.bak/project.yaml", ROOT)).toBeNull();
  });
});

describe("childrenOf", () => {
  it("finds every level once the path is in the tree's own space", () => {
    const rel = underRoot(OPEN, ROOT)!;
    for (const p of dirPrefixes(rel))
      expect(childrenOf(TREE, p).length).toBeGreaterThan(0);
    expect(childrenOf(TREE, "modules/io/OUT").map((n) => n.name)).toEqual([
      "module.yaml",
    ]);
  });

  it("finds NOTHING when handed the workspace-relative path — the bug, pinned", () => {
    for (const p of dirPrefixes(OPEN).slice(1))
      expect(childrenOf(TREE, p)).toEqual([]);
  });

  it("still answers the whole tree for the root segment", () => {
    expect(childrenOf(TREE, "").map((n) => n.name)).toEqual([
      "modules",
      "project.yaml",
    ]);
  });
});

describe("drilling in", () => {
  it("re-keys a folder chosen from a menu, so the next level resolves too", () => {
    // What the click handler does: the node's path is workspace-relative, the menu key is not.
    const chosen = childrenOf(TREE, "modules").find((n) => n.dir)!;
    expect(chosen.path).toBe(`${ROOT}/modules/io`);
    const key = underRoot(chosen.path, ROOT) ?? chosen.path;
    expect(childrenOf(TREE, key).map((n) => n.name)).toEqual(["OUT"]);
  });
});
