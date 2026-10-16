import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "@studio/song-schema/yaml/chainSchema";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { describe, expect, it } from "vitest";
import {
  chainFilePath,
  fromSegments,
  readChainProject,
  toSegments,
  writeChainProject,
} from "./chainProject";

// A song's worth of shapes: an input into a lane, a parallel pair, a send to a bus at a level, a sidechain, the master.
const graph: GraphFile = {
  modules: {
    "gtr-in": ["gtr"],
    gtr: ["amp"],
    amp: ["comp-a", "comp-b"],
    "comp-a": ["mixer"],
    "comp-b": ["mixer"],
    mixer: ["MIX", "verb"],
    kick: ["duck#sc", "MIX"],
    verb: ["duck"],
    duck: ["MIX"],
    MIX: ["OUT"],
  },
  bypassed: ["comp-b"],
};
const lanes = new Set(["gtr", "kick"]);
const itemOf = (n: string): Item =>
  lanes.has(n)
    ? { id: `id-${n}`, track: n }
    : { id: n, extends: `@k7-core/${n}` };
const isSource = (n: string) => lanes.has(n) || n === "gtr-in";

describe("fromSegments", () => {
  const chains = fromSegments(graph, {
    itemOf,
    isSource,
    levels: { "mixer>verb": 0.3 },
    nameFor: (h) => h,
  });

  it("runs a lane from the input that feeds it, named after the lane, through a parallel step, to its links", () => {
    const c = chains.gtr;
    expect(c.start).toBe(true);
    expect(c.steps.length).toBe(6);
    expect(Array.isArray(c.steps[3])).toBe(true);
    expect(c.steps[5]).toEqual({
      to: [
        { chain: "MIX", level: 1 },
        { chain: "verb", level: 0.3 },
      ],
    });
  });

  it("keeps a bypass on the item, and a chain fed by a port declares it", () => {
    const par = chains.gtr.steps[3] as Item[];
    expect(par.find((i) => i.id === "comp-b")?.bypass).toBe(true);
    expect(chains.duck.ports).toEqual(["sc"]);
    expect(chains.duck.start).toBeUndefined();
  });

  it("starts the master chain at MIX", () => {
    expect(chains.master).toEqual({
      start: "MIX",
      steps: [{ to: [{ chain: "OUT" }] }],
    });
  });

  it("gives back the same segments it was written from", () => {
    const dir = mkdtempSync(join(tmpdir(), "chains-"));
    writeChainProject(dir, chains);
    const back = toSegments(readChainProject(dir));
    expect(back.graph.modules).toEqual(graph.modules);
    expect(back.graph.bypassed).toEqual(["comp-b"]);
    // Several links each carry a level, so kick's two gain theirs at unity.
    expect(back.levels).toEqual({
      "mixer>MIX": 1,
      "mixer>verb": 0.3,
      "kick>duck#sc": 1,
      "kick>MIX": 1,
    });
  });
});

describe("a chain nothing links", () => {
  it("is hidden, unless a card of it was placed on the graph", () => {
    const dir = mkdtempSync(join(tmpdir(), "chains-"));
    mkdirSync(join(dir, "chains"));
    writeFileSync(
      join(dir, "chains", "loose.yaml"),
      'steps:\n  - { id: d1, extends: "@k7-core/delay" }\n',
    );
    const cp = readChainProject(dir);
    expect(toSegments(cp).graph.modules).toEqual({});
    expect(toSegments(cp, { d1: { x: 0, y: 0 } }).graph.modules).toEqual({
      d1: [],
    });
  });
});

describe("writeChainProject", () => {
  it("keeps a node's comment through a rewrite that moves it", () => {
    const dir = mkdtempSync(join(tmpdir(), "chains-"));
    mkdirSync(join(dir, "chains"));
    const text =
      'start: true\nsteps:\n  - { id: l, track: lane }\n  # the touch wah\n  - id: w\n    extends: "@k7-core/wah"\n';
    writeFileSync(join(dir, "chains", "lane.yaml"), text);
    const cp = readChainProject(dir);
    const c = cp.chains.lane;
    c.steps.push({ id: "x", extends: "@k7-core/eq" });
    writeChainProject(dir, cp.chains, cp.texts);
    const again = readChainProject(dir);
    expect(again.texts.lane).toContain("# the touch wah");
    expect(again.chains.lane.steps.length).toBe(3);
  });
});

describe("naming a chain on a rewrite", () => {
  it("names a run after the lane it holds, even when an input's chain absorbed it", () => {
    const prev = {
      chains: {},
      texts: {},
      issues: [],
      nodes: {
        mic: {
          name: "mic",
          id: "mic",
          chain: "mic-chain",
          step: 0,
          item: null,
          value: { id: "mic" },
        },
      },
    };
    const chains = fromSegments(
      { modules: { mic: ["vox"], vox: ["MIX"], MIX: ["OUT"] } },
      {
        itemOf: (n) => (n === "vox" ? { id: "v", track: "vox" } : { id: n }),
        isSource: () => true,
        prev,
      },
    );
    expect(Object.keys(chains).sort()).toEqual(["master", "vox"]);
  });
});

describe("reading order", () => {
  it("follows chain names, so `a` comes before `a-copy` as their lanes did", () => {
    const dir = mkdtempSync(join(tmpdir(), "chains-"));
    mkdirSync(join(dir, "chains"));
    for (const n of ["a-copy", "a"])
      writeFileSync(
        join(dir, "chains", `${n}.yaml`),
        `start: true\nsteps:\n  - { id: ${n}, track: ${n} }\n`,
      );
    expect(Object.keys(readChainProject(dir).chains)).toEqual(["a", "a-copy"]);
  });
});

describe("a chain's file", () => {
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-file-"));
    mkdirSync(join(dir, "chains"));
    return dir;
  };
  const touch = (dir: string, f: string) =>
    writeFileSync(join(dir, "chains", f), "steps: []\n");

  it("is .yaml for a new chain", () => {
    const dir = folder();
    expect(chainFilePath(dir, "a")).toBe(join(dir, "chains", "a.yaml"));
  });

  it("takes .k7x over .yaml over .yml", () => {
    const dir = folder();
    touch(dir, "a.yml");
    expect(chainFilePath(dir, "a")).toBe(join(dir, "chains", "a.yml"));
    touch(dir, "a.yaml");
    expect(chainFilePath(dir, "a")).toBe(join(dir, "chains", "a.yaml"));
    touch(dir, "a.k7x");
    expect(chainFilePath(dir, "a")).toBe(join(dir, "chains", "a.k7x"));
  });

  it("stays .yml when a .yml chain is read and written back", () => {
    const dir = folder();
    writeFileSync(
      join(dir, "chains", "a.yml"),
      "start: true\nsteps:\n  - { id: a, track: a }\n",
    );
    const cp = readChainProject(dir);
    expect(Object.keys(cp.chains)).toEqual(["a"]);
    writeChainProject(dir, { a: { ...cp.chains.a, hidden: true } }, cp.texts);
    expect(existsSync(join(dir, "chains", "a.yaml"))).toBe(false);
    expect(readChainProject(dir).hidden?.a).toBeDefined();
  });
});
