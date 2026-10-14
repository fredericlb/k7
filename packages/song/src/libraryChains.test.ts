// The walk over every library's `chains/`, and the reader of one. It answers every caller — a
// workspace's chains builder, the account's listing, a bounce, the bench — so what it files as a
// chain and the steps it reads are what all of them run.
//
// What would be wrong silently: descending INTO a folder chain, throwing on a library with no
// chains, a bare ref no longer meaning the default library, and a chain FILE read as anything but
// one run ending at `@out`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chainRefParts,
  findLibraryChain,
  libraryChainDirs,
  readTemplate,
} from "./libraryChains.ts";
import { librariesFixture } from "./testSupport";

let root: string;

/** A chain is a FOLDER holding a graph file; `nodes` are the yaml files beside it. */
function chain(
  path: string,
  nodes: string[] = [],
  library = "k7-core",
): string {
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
      "@k7-core/bass/amp",
      "@k7-core/di",
      "@k7-core/gtr/lead/crunch",
    ]);
  });

  it("walks every library, each under its own name", () => {
    chain("di");
    chain("kit/room", [], "drums");
    expect(libraryChainDirs().map((c) => [c.ref, c.library, c.path])).toEqual([
      ["@drums/kit/room", "drums", "kit/room"],
      ["@k7-core/di", "k7-core", "di"],
    ]);
  });

  it("lists a chain's node files, and none of anything else beside them", () => {
    const at = chain("di", ["amp.yaml", "cab.yml"]);
    writeFileSync(join(at, "nodes", "readme.md"), "not a node\n");
    const [found] = libraryChainDirs();
    expect(found.nodes).toEqual(["amp.yaml", "cab.yml"]);
    expect(found.at).toBe(at);
    expect(found.layout).toBe("folder");
  });

  it("stops at the graph file rather than descending into a chain", () => {
    const at = chain("di", ["amp.yaml"]);
    // A folder INSIDE a chain is part of it; walking on would file `di/presets` as a chain of its own.
    mkdirSync(join(at, "presets"), { recursive: true });
    writeFileSync(join(at, "presets", "graph.yaml"), "modules: {}\n");
    expect(libraryChainDirs().map((c) => c.ref)).toEqual(["@k7-core/di"]);
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
      library: "k7-core",
      path: "bass/di",
    });
    expect(chainRefParts("@drums/kit")).toEqual({
      library: "drums",
      path: "kit",
    });
  });

  it("refuses what names no chain folder", () => {
    expect(chainRefParts("@engine/x")).toBeNull();
    expect(chainRefParts("@k7-core/../x")).toBeNull();
    expect(chainRefParts("")).toBeNull();
  });

  it("finds a chain bare or by its library, and not in another library", () => {
    chain("di");
    chain("room", [], "drums");
    expect(findLibraryChain("di")?.ref).toBe("@k7-core/di");
    expect(findLibraryChain("@k7-core/di")?.ref).toBe("@k7-core/di");
    expect(findLibraryChain("@drums/room")?.ref).toBe("@drums/room");
    expect(findLibraryChain("room")).toBeUndefined();
    expect(findLibraryChain("@drums/di")).toBeUndefined();
  });
});

/** A chain FILE `chains/<path>.yaml` in `library`, its text as given. */
function chainFile(path: string, text: string, library = "k7-core"): string {
  const at = join(librariesFixture(root, library), "chains", `${path}.yaml`);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
  return at;
}

const TWO_STEPS = `steps:
  - { id: n1, extends: "@k7-core/audio/comp", params: { Ratio: 0.5 } }
  - { id: n2, extends: "@k7-core/audio/eq", bypass: true }
  - to: [ { chain: "@out" } ]
`;

describe("chain files", () => {
  it("files a `<path>.yaml` as the chain `<path>`, beside folder chains", () => {
    chainFile("vocals/warm", TWO_STEPS);
    chain("di");
    expect(
      libraryChainDirs().map((c) => [c.ref, c.layout, c.nodes.length]),
    ).toEqual([
      ["@k7-core/di", "folder", 0],
      ["@k7-core/vocals/warm", "file", 0],
    ]);
  });

  it("answers the FILE when a ref is held both ways — the folder is what was migrated", () => {
    chain("di");
    const at = chainFile("di", TWO_STEPS);
    const found = libraryChainDirs();
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe(at);
  });

  it("reads the steps in order: module fields alone, the bypass, a message label", () => {
    chainFile("vocals/warm", TWO_STEPS);
    const [c] = libraryChainDirs();
    const { steps, missing } = readTemplate(c);
    expect(missing).toEqual([]);
    expect(steps).toEqual([
      {
        name: "n1",
        label: "@k7-core/audio/comp",
        module: { extends: "@k7-core/audio/comp", params: { Ratio: 0.5 } },
      },
      {
        name: "n2",
        label: "@k7-core/audio/eq",
        module: { extends: "@k7-core/audio/eq" },
        bypass: true,
      },
    ]);
  });

  it("finds a node's preset in the LIBRARY's vstpresets/, by its id", () => {
    const lib = librariesFixture(root, "k7-core");
    chainFile("vocals/warm", TWO_STEPS);
    mkdirSync(join(lib, "vstpresets"), { recursive: true });
    writeFileSync(join(lib, "vstpresets", "n1.vstpreset"), "x");
    const [c] = libraryChainDirs();
    const [first, second] = readTemplate(c).steps;
    expect(first.preset).toBe(join(lib, "vstpresets", "n1.vstpreset"));
    expect(second.preset).toBeUndefined();
  });

  it("refuses what is not one run to `@out`, by name", () => {
    const read = (text: string) => () => {
      rmSync(join(root, ".studio-home"), { recursive: true, force: true });
      chainFile("x", text);
      return readTemplate(libraryChainDirs()[0]);
    };
    expect(read("start: true\nsteps:\n  - { id: a, extends: x }\n")).toThrow(
      /no `start`/,
    );
    expect(
      read(
        "steps:\n  - { id: a, extends: x }\n  - [ { id: b, extends: x }, { id: c, extends: x } ]\n",
      ),
    ).toThrow(/side by side/);
    expect(
      read("steps:\n  - { id: a, extends: x }\n  - to: [ { chain: MIX } ]\n"),
    ).toThrow(/links only to "@out"/);
    expect(read("steps: [ 3 ]\n")).toThrow();
  });
});

describe("folder chains, read", () => {
  it("reads the derived steps and names a node file that is not there", () => {
    const at = chain("di", ["amp.yaml"]);
    writeFileSync(
      join(at, "graph.yaml"),
      'modules:\n  "@in": [ amp ]\n  amp: [ cab ]\n  cab: [ "@out" ]\nbypassed: [ amp ]\n',
    );
    const { steps, missing } = readTemplate(libraryChainDirs()[0]);
    expect(steps.map((s) => [s.name, s.bypass])).toEqual([["amp", true]]);
    expect(missing).toEqual(["cab (no nodes/cab.yaml)"]);
  });
});
