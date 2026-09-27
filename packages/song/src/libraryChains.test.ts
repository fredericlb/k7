// The walk over every library's `chains/`. It answers every caller — a workspace's chains builder,
// the ACCOUNT's own listing, a bounce — so what it files as a chain is what all of them draw.
//
// What would be wrong silently: descending INTO a chain (a nodes folder read as chains of its
// own), throwing on a library that holds no chains at all, which is a new account's state, and a
// bare ref no longer meaning the default library, which every ref written before names did.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chainRefParts,
  findLibraryChain,
  libraryChainDirs,
} from "./libraryChains.ts";
import { librariesFixture } from "./testSupport";

let root: string;

/** A chain is a FOLDER holding a graph file; `nodes` are the yaml files beside it. */
function chain(path: string, nodes: string[] = [], library = "st0"): string {
  const at = join(
    librariesFixture(root, library),
    "chains",
    ...path.split("/"),
  );
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "graph.yaml"), "modules: {}\n");
  if (nodes.length) mkdirSync(join(at, "nodes"), { recursive: true });
  for (const n of nodes) writeFileSync(join(at, "nodes", n), "params: {}\n");
  return at;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chains-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("libraryChainDirs", () => {
  it("names each chain `@<library>/<path under chains/>`", () => {
    chain("di");
    chain("bass/amp");
    chain("gtr/lead/crunch");
    expect(libraryChainDirs().map((c) => c.ref)).toEqual([
      "@st0/bass/amp",
      "@st0/di",
      "@st0/gtr/lead/crunch",
    ]);
  });

  it("walks every library, each under its own name", () => {
    chain("di");
    chain("kit/room", [], "drums");
    expect(libraryChainDirs().map((c) => [c.ref, c.library, c.path])).toEqual([
      ["@drums/kit/room", "drums", "kit/room"],
      ["@st0/di", "st0", "di"],
    ]);
  });

  it("lists a chain's node files, and none of anything else beside them", () => {
    const at = chain("di", ["amp.yaml", "cab.yml"]);
    writeFileSync(join(at, "nodes", "readme.md"), "not a node\n");
    const [found] = libraryChainDirs();
    expect(found.nodes).toEqual(["amp.yaml", "cab.yml"]);
    expect(found.dir).toBe(at);
  });

  it("stops at the graph file rather than descending into a chain", () => {
    const at = chain("di", ["amp.yaml"]);
    // A folder INSIDE a chain is part of it; walking on would file `di/presets` as a chain of its own.
    mkdirSync(join(at, "presets"), { recursive: true });
    writeFileSync(join(at, "presets", "graph.yaml"), "modules: {}\n");
    expect(libraryChainDirs().map((c) => c.ref)).toEqual(["@st0/di"]);
  });

  it("says nothing rather than throwing when no library has a chains folder", () => {
    // A library nobody has written a chain into yet, which is every new account's.
    librariesFixture(root);
    expect(libraryChainDirs()).toEqual([]);
  });

  it("keeps a chain with no nodes folder — that is a real state, not an empty one", () => {
    chain("di");
    expect(libraryChainDirs()[0].nodes).toEqual([]);
  });
});

describe("chainRefParts / findLibraryChain", () => {
  it("reads a BARE ref as the default library's", () => {
    expect(chainRefParts("bass/di")).toEqual({
      library: "st0",
      path: "bass/di",
    });
    expect(chainRefParts("@drums/kit")).toEqual({
      library: "drums",
      path: "kit",
    });
  });

  it("refuses what names no chain folder", () => {
    expect(chainRefParts("@engine/x")).toBeNull();
    expect(chainRefParts("@st0/../x")).toBeNull();
    expect(chainRefParts("")).toBeNull();
  });

  it("finds a chain bare or by its library, and not in another library", () => {
    chain("di");
    chain("room", [], "drums");
    expect(findLibraryChain("di")?.ref).toBe("@st0/di");
    expect(findLibraryChain("@st0/di")?.ref).toBe("@st0/di");
    expect(findLibraryChain("@drums/room")?.ref).toBe("@drums/room");
    expect(findLibraryChain("room")).toBeUndefined();
    expect(findLibraryChain("@drums/di")).toBeUndefined();
  });
});
