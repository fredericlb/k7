// The walk over a library's `chains/`. It answers two callers — a workspace's chains builder and
// the ACCOUNT's own listing on st0's home page — so what it files as a chain is what both draw.
//
// What would be wrong silently: descending INTO a chain (a nodes folder read as chains of its
// own), and throwing on a library that holds no chains at all, which is a new account's state.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkLibraryChains } from "./libraryChains.ts";

let root: string;

/** A chain is a FOLDER holding a graph file; `nodes` are the yaml files beside it. */
function chain(ref: string, nodes: string[] = []): void {
  const at = join(root, ...ref.split("/"));
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "graph.yaml"), "modules: {}\n");
  if (nodes.length) mkdirSync(join(at, "nodes"), { recursive: true });
  for (const n of nodes) writeFileSync(join(at, "nodes", n), "params: {}\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chains-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("walkLibraryChains", () => {
  it("names each chain by its path under the chains root", () => {
    chain("di");
    chain("bass/amp");
    chain("gtr/lead/crunch");
    expect(walkLibraryChains(root).map((c) => c.ref)).toEqual([
      "bass/amp",
      "di",
      "gtr/lead/crunch",
    ]);
  });

  it("lists a chain's node files, and none of anything else beside them", () => {
    chain("di", ["amp.yaml", "cab.yml"]);
    writeFileSync(join(root, "di", "nodes", "readme.md"), "not a node\n");
    const [found] = walkLibraryChains(root);
    expect(found.nodes).toEqual(["amp.yaml", "cab.yml"]);
    expect(found.dir).toBe(join(root, "di"));
  });

  it("stops at the graph file rather than descending into a chain", () => {
    chain("di", ["amp.yaml"]);
    // A folder INSIDE a chain is part of it; walking on would file `di/nodes` as a chain of its own.
    mkdirSync(join(root, "di", "presets"), { recursive: true });
    writeFileSync(join(root, "di", "presets", "graph.yaml"), "modules: {}\n");
    expect(walkLibraryChains(root).map((c) => c.ref)).toEqual(["di"]);
  });

  it("says nothing rather than throwing when there is no chains folder", () => {
    // A library nobody has written a chain into yet, which is every new account's.
    expect(walkLibraryChains(join(root, "absent"))).toEqual([]);
  });

  it("keeps a chain with no nodes folder — that is a real state, not an empty one", () => {
    chain("di");
    expect(walkLibraryChains(root)[0].nodes).toEqual([]);
  });
});
