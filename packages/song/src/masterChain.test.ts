// The MASTER CHAIN: the run between MIX (where the mixer sums) and OUT (the interface).
//
// What is pinned here is the split itself — that a lane's chain still ends at the sum, that a
// chain wired MIX -> OUT processes the whole mix instead of vanishing, and that an empty
// MIX -> OUT run changes not one byte of the compiled document.
// See docs/masterChain.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { writeDoc, writeLane, writeNode } from "./testSupport";

let dir: string;

type Modules = Record<string, string[]>;

function project(modules: Modules): void {
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeNode(dir, "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeNode(dir, "squeeze", {
    plugin: { type: "internal", name: "Compressor" },
  });
  writeNode(dir, "shelf", {
    plugin: { type: "internal", name: "EqualiserPlugin" },
  });
  writeLane(dir, "gtr");
  writeDoc(join(dir, "graph.k7x"), { modules });
}

const compile = () => compileNodeProject(dir);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "master-chain-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `graph.k7x` declares SEGMENTS — who feeds whom — and the chains are derived from them. */
const PLAIN: Modules = { gtr: ["amp"], amp: ["MIX"] };

describe("a song with no master chain", () => {
  it("still sends the field, empty — an absent one would read as unchanged", () => {
    // The engine diffs documents, so a DELETED master chain left out never comes off the bus.
    project(PLAIN);
    expect(compile().masterPlugins).toEqual([]);
  });

  it("puts the lane's own plugins on its track, not on the master", () => {
    project(PLAIN);
    const doc = compile();
    expect(doc.tracks.find((t) => t.id === "gtr")?.plugins).toHaveLength(1);
    expect(doc.masterPlugins).toEqual([]);
  });
});

describe("a chain from MIX to OUT", () => {
  const withMaster: Modules = {
    ...PLAIN,
    MIX: ["squeeze"],
    squeeze: ["shelf"],
    shelf: ["OUT"],
  };

  it("compiles its steps onto the master, in chain order", () => {
    project(withMaster);
    const doc = compile();
    expect(doc.masterPlugins.map((p) => p.name)).toEqual(["squeeze", "shelf"]);
  });

  it("does NOT become a track of its own", () => {
    // The failure to avoid is a phantom lane called `master` in the arrangement.
    project(withMaster);
    expect(compile().tracks.map((t) => t.id)).toEqual(["gtr"]);
  });

  it("leaves the lane's own chain alone", () => {
    project(withMaster);
    const doc = compile();
    expect(doc.tracks[0].plugins.map((p) => p.name)).toEqual(["amp"]);
  });

  it("carries the same plugin shape a track's steps do", () => {
    // Filed under a reserved OWNER so there is one step-to-plugin conversion and no drift.
    project(withMaster);
    const p = compile().masterPlugins[0];
    expect(p).toMatchObject({ name: "squeeze", enabled: true });
    expect(typeof p.id).toBe("string");
    expect(p.params).toBeDefined();
  });
});

// The line declares the run without putting anything on it, giving the graph an OUT node to draw.
describe("the empty MIX -> OUT run every project now carries", () => {
  const BARE: Modules = { ...PLAIN, MIX: ["OUT"] };

  it("compiles, and changes NOTHING about the document", () => {
    // A line that costs no sound: if this stops matching, the empty run changes every project.
    project(BARE);
    const bare = compile();
    project(PLAIN);
    expect(bare).toEqual(compile());
  });

  it("leaves masterPlugins empty rather than inventing a step", () => {
    project(BARE);
    expect(compile().masterPlugins).toEqual([]);
  });

  it("still becomes a master chain the moment a module joins it", () => {
    project({ ...PLAIN, MIX: ["squeeze"], squeeze: ["OUT"] });
    expect(compile().masterPlugins.map((p) => p.name)).toEqual(["squeeze"]);
  });
});

describe("what MIX and OUT mean", () => {
  it("accepts a lane's chain ending at either, so an old song still compiles", () => {
    // `out: [OUT]` still routes to the sum, but with a master chain present it would BYPASS it.
    project({ gtr: ["amp"], amp: ["OUT"] });
    const doc = compile();
    expect(doc.tracks.find((t) => t.id === "gtr")?.plugins).toHaveLength(1);
    expect(doc.masterPlugins).toEqual([]);
  });

  it("needs no modules/io folder for either name", () => {
    // `isSink` takes both literally; having to declare them would break every demo song.
    project(PLAIN);
    expect(() => compile()).not.toThrow();
  });
});
