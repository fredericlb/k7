import type { FileNode } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { changedOf, withChanges } from "./changedTree";

const TREE: FileNode[] = [
  {
    name: "a.st0",
    path: "a.st0",
    dir: true,
    children: [{ name: "song.yaml", path: "a.st0\\song.yaml", dir: false }],
  },
];

describe("changedOf", () => {
  it("marks every ancestor folder of a changed path", () => {
    const c = changedOf([{ path: "a.st0/tracks/x.yaml", code: " M" }]);
    expect(c.codes.get("a.st0/tracks/x.yaml")).toBe(" M");
    expect([...c.dirs]).toEqual(["a.st0", "a.st0/tracks"]);
  });
});

describe("withChanges", () => {
  it("leaves the tree alone when every change is in it, whatever the separator", () => {
    expect(withChanges(TREE, [{ path: "a.st0/song.yaml", code: " M" }])).toBe(
      TREE,
    );
  });

  it("adds a deleted file, and the folders it was in", () => {
    const t = withChanges(TREE, [{ path: "a.st0/old/gone.yaml", code: " D" }]);
    const old = t[0].children?.find((n) => n.name === "old");
    expect(old?.dir).toBe(true);
    expect(old?.children?.[0]).toMatchObject({
      path: "a.st0/old/gone.yaml",
      dir: false,
    });
    expect(TREE[0].children).toHaveLength(1);
  });
});
