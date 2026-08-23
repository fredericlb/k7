// The MASTER CHAIN: the run between MIX (where the mixer sums) and OUT (the interface).
//
// What is pinned here is the split itself — that a lane's chain still ends at the sum, that a
// chain wired MIX -> OUT processes the whole mix instead of vanishing, and that a song without
// one is byte-for-byte the document it was before the two nodes were told apart.
// See docs/masterChain.md.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { writeLane, writeModule } from "./testSupport";

let dir: string;

function project(graph: string): void {
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeModule(dir, "audio", "amp", {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeModule(dir, "audio", "squeeze", {
    plugin: { type: "internal", name: "Compressor" },
  });
  writeModule(dir, "audio", "shelf", {
    plugin: { type: "internal", name: "EqualiserPlugin" },
  });
  writeLane(dir, "gtr");
  writeFileSync(join(dir, "graph.yaml"), graph, "utf8");
}

const compile = () => compileNodeProject(dir);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "master-chain-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `graph.yaml` declares SEGMENTS — who feeds whom — and the chains are derived from them. */
const PLAIN = "modules:\n  gtr: [ amp ]\n  amp: [ MIX ]\n";

describe("a song with no master chain", () => {
  it("still sends the field, empty — an absent one would read as unchanged", () => {
    // The engine diffs documents. Left out, a master chain that was DELETED would never come
    // off the bus, which is the same trap masterVolume is defaulted for.
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
  const withMaster =
    "modules:\n" +
    "  gtr: [ amp ]\n" +
    "  amp: [ MIX ]\n" +
    "  MIX: [ squeeze ]\n" +
    "  squeeze: [ shelf ]\n" +
    "  shelf: [ OUT ]\n";

  it("compiles its steps onto the master, in chain order", () => {
    project(withMaster);
    const doc = compile();
    expect(doc.masterPlugins.map((p) => p.name)).toEqual(["squeeze", "shelf"]);
  });

  it("does NOT become a track of its own", () => {
    // Before it had an owner, a chain fed by no lane was dropped; the failure to avoid now is
    // the opposite one — a phantom lane called `master` appearing in the arrangement.
    project(withMaster);
    expect(compile().tracks.map((t) => t.id)).toEqual(["gtr"]);
  });

  it("leaves the lane's own chain alone", () => {
    project(withMaster);
    const doc = compile();
    expect(doc.tracks[0].plugins.map((p) => p.name)).toEqual(["amp"]);
  });

  it("carries the same plugin shape a track's steps do", () => {
    // The whole reason a master chain is filed under a reserved OWNER rather than compiled by a
    // second code path: one step-to-plugin conversion, so the two cannot drift.
    project(withMaster);
    const p = compile().masterPlugins[0];
    expect(p).toMatchObject({ name: "squeeze", enabled: true });
    expect(typeof p.id).toBe("string");
    expect(p.params).toBeDefined();
  });
});

// Every project written by a scaffold carries this line, and the migration adds it to the rest.
// It declares the run without putting anything on it — which is what gives the graph an OUT node
// to draw the output fader on, and a place to drop a master plugin into.
describe("the empty MIX -> OUT run every project now carries", () => {
  const BARE = "modules:\n  gtr: [ amp ]\n  amp: [ MIX ]\n  MIX: [ OUT ]\n";

  it("compiles, and changes NOTHING about the document", () => {
    // The whole point of writing it into every scaffold: a line that costs no sound. If this ever
    // stops matching, every project in existence changed the day it was added.
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
    project(
      "modules:\n  gtr: [ amp ]\n  amp: [ MIX ]\n  MIX: [ squeeze ]\n  squeeze: [ OUT ]\n",
    );
    expect(compile().masterPlugins.map((p) => p.name)).toEqual(["squeeze"]);
  });
});

describe("what MIX and OUT mean", () => {
  it("accepts a lane's chain ending at either, so an old song still compiles", () => {
    // `out: [OUT]` on a lane is what every song written before the split says. It still routes
    // to the sum — but see docs/masterChain.md: with a master chain present it would BYPASS it,
    // which is what the migration exists to fix.
    project("modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n");
    const doc = compile();
    expect(doc.tracks.find((t) => t.id === "gtr")?.plugins).toHaveLength(1);
    expect(doc.masterPlugins).toEqual([]);
  });

  it("needs no modules/io folder for either name", () => {
    // Neither is a module on disk: `isSink` takes both literally. A project that had to declare
    // them would break every demo song.
    project(PLAIN);
    expect(() => compile()).not.toThrow();
  });
});
