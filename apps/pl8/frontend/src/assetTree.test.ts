import type { TreeNode } from "@frediverse/ui/file-tree";
import { describe, expect, it } from "vitest";
import { assetNodes, folderAt } from "./assetTree";

const BASE = "audio/amps/guitar/assets";

describe("assetNodes", () => {
  it("nests a pack back into folders", () => {
    const nodes = assetNodes(
      ["loose.nam", "two rocks/clean.nam", "two rocks/crunch.nam"],
      BASE,
    );
    expect(nodes.map((n) => n.name)).toEqual(["loose.nam", "two rocks"]);
    const pack = nodes.find((n) => n.name === "two rocks");
    expect(pack?.dir).toBe(true);
    expect(pack?.children?.map((n) => n.name)).toEqual([
      "clean.nam",
      "crunch.nam",
    ]);
  });

  it("addresses every row at the file that is actually there", () => {
    // A drop, a move, a rename and a delete all go through the path, so a row naming anything
    // but its real place on the server would act on the wrong file — or on none.
    const [pack] = assetNodes(["two rocks/clean.nam"], BASE);
    expect(pack?.path).toBe(`${BASE}/two rocks`);
    expect(pack?.children?.[0]?.path).toBe(`${BASE}/two rocks/clean.nam`);
  });

  it("does not draw the `assets` segment itself", () => {
    // A module's children ARE its assets; a fixed row between them and it would be a level
    // with nothing to choose in it. The segment stays in the path and off the screen.
    const nodes = assetNodes(["loose.nam"], BASE);
    expect(nodes.map((n) => n.name)).toEqual(["loose.nam"]);
    expect(nodes[0]?.path).toBe(`${BASE}/loose.nam`);
  });

  it("makes a row for a folder holding nothing", () => {
    // Somewhere to drop into before the first file — the whole reason the scan bothers to
    // report it. A folder, so the shared tree treats it as a drop target at all.
    const [empty] = assetNodes(["empty/"], BASE);
    expect(empty).toMatchObject({
      name: "empty",
      path: `${BASE}/empty`,
      dir: true,
      children: [],
    });
  });

  it("goes as deep as the paths do", () => {
    const [a] = assetNodes(["a/b/c/deep.nam"], BASE);
    const c = a?.children?.[0]?.children?.[0];
    expect(c).toMatchObject({ name: "c", dir: true });
    expect(c?.children?.[0]?.path).toBe(`${BASE}/a/b/c/deep.nam`);
  });

  it("says nothing about a module that carries nothing", () => {
    expect(assetNodes([], BASE)).toEqual([]);
  });

  it("keeps a folder when a listing also names it as a leaf", () => {
    // The scan never emits both, but a listing is what a server said: the folder wins, since
    // replacing it with a leaf would hide its children.
    const nodes = assetNodes(["pack/x.nam", "pack"], BASE);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.children?.map((n) => n.name)).toEqual(["x.nam"]);
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
