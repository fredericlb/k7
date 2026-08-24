import { describe, expect, it } from "vitest";
import { deriveChains, isParked } from "./chainsGraph";

// The file says who feeds whom; every rule about a chain's shape is DERIVED here.

const chains = (file: unknown, lanes: string[] = []) =>
  deriveChains(file, (n) => lanes.includes(n));

describe("a run, from a lane to the sink", () => {
  it("follows the arrows and stops at the destination", () => {
    const g = chains(
      { modules: { "da.main": ["drum_1"], drum_1: ["eq"], eq: ["OUT"] } },
      ["da.main"],
    );
    // The chain is called after its lane, and OUT is where it goes — not a step in it.
    expect(g["da.main"]).toEqual({
      from: "da.main",
      use: [{ module: "drum_1" }, { module: "eq" }],
      out: [{ to: "OUT", gain: 1 }],
    });
    expect(Object.keys(g)).toEqual(["da.main"]);
  });

  it("carries the bypass onto the step", () => {
    const g = chains(
      { modules: { a: ["eq"], eq: ["OUT"] }, bypassed: ["eq"] },
      ["a"],
    );
    expect(g.a.use).toEqual([{ module: "eq", enabled: false }]);
  });

  it("gives a lane with no modules a chain that is just its output", () => {
    const g = chains({ modules: { a: ["OUT"] } }, ["a"]);
    expect(g.a).toEqual({ from: "a", use: [], out: [{ to: "OUT", gain: 1 }] });
  });

  it("ignores a lane that feeds nothing", () => {
    // An empty destination list must mean what not listing it means, or "not wired" has two spellings.
    expect(chains({ modules: { a: [], b: ["OUT"] } }, ["a", "b"])).toEqual({
      b: { from: "b", use: [], out: [{ to: "OUT", gain: 1 }] },
    });
  });
});

describe("where a run breaks", () => {
  it("breaks where two signals MEET — that is what a bus is", () => {
    const g = chains({ modules: { a: ["verb"], b: ["verb"], verb: ["OUT"] } }, [
      "a",
      "b",
    ]);
    // Neither lane owns the reverb, so it becomes a chain of its own and both route INTO it.
    expect(g.a).toEqual({ from: "a", use: [], out: [{ to: "verb", gain: 1 }] });
    expect(g.b.out).toEqual([{ to: "verb", gain: 1 }]);
    expect(g.verb).toEqual({
      use: [{ module: "verb" }],
      out: [{ to: "OUT", gain: 1 }],
    });
  });

  it("breaks where the signal SPLITS", () => {
    const g = chains(
      { modules: { a: ["eq"], eq: ["verb", "OUT"], verb: ["OUT"] } },
      ["a"],
    );
    // `eq` stays in the lane's run, but what the split reaches is not on one path.
    expect(g.a.use).toEqual([{ module: "eq" }]);
    expect(g.a.out).toEqual([
      { to: "verb", gain: 1 },
      { to: "OUT", gain: 1 },
    ]);
    expect(g.verb.use).toEqual([{ module: "verb" }]);
  });

  it("does not absorb a module into a run that only sends it a share", () => {
    // Every branch of a split starts its own chain, or a send joins the dry path silently.
    const g = chains(
      {
        modules: {
          a: ["eq"],
          eq: ["verb", "OUT"],
          verb: ["tail"],
          tail: ["OUT"],
        },
      },
      ["a"],
    );
    expect(g.verb.use).toEqual([{ module: "verb" }, { module: "tail" }]);
  });

  it("never absorbs a LANE, whatever feeds it", () => {
    // A live input passes every absorption test, and absorbing it destroys the lane's own chain.
    const g = chains(
      { modules: { "in-1": ["gtr"], gtr: ["amp"], amp: ["OUT"] } },
      ["gtr"],
    );
    expect(g.gtr).toEqual({
      from: "gtr",
      use: [{ module: "amp" }],
      out: [{ to: "OUT", gain: 1 }],
    });
    expect(g["in-1"]).toEqual({
      use: [{ module: "in-1" }],
      out: [{ to: "gtr", gain: 1 }],
    });
  });
});

describe("nodes at the edges", () => {
  it("keeps a module nothing feeds, wired to nothing", () => {
    // An unwired module is a real editor state: it must survive the file being re-read.
    const g = chains({ modules: { "@engine/io/IN/in-1": [] } });
    expect(g["@engine/io/IN/in-1"]).toEqual({
      use: [{ module: "@engine/io/IN/in-1" }],
      out: [],
    });
    expect(isParked(g["@engine/io/IN/in-1"])).toBe(true);
  });

  it("does not call a wired chain parked", () => {
    const g = chains({ modules: { a: ["eq"], eq: ["OUT"] } }, ["a"]);
    expect(isParked(g.a)).toBe(false);
  });

  it("treats `@in` as a lane with no project to ask", () => {
    // A chain TEMPLATE has no modules folder, so `@in` is a lane by name and nothing else.
    const g = chains({ modules: { "@in": ["eq"], eq: ["@out"] } });
    expect(g["@in"]).toEqual({
      from: "@in",
      use: [{ module: "eq" }],
      out: [{ to: "@out", gain: 1 }],
    });
  });

  it("keeps a cycle's modules visible instead of dropping them", () => {
    // Nothing in a cycle is a root, so without this the modules vanish before validate() sees them.
    const g = chains({ modules: { a: ["b"], b: ["a"] } });
    expect(Object.keys(g)).toEqual(["a"]);
    expect(g.a.use.map((s) => s.module)).toEqual(["a", "b"]);
  });
});

describe("what it refuses", () => {
  it("names the old list format, and the SCRIPT that converts it", () => {
    // This message is the only place anyone meets the script, so it has to name it in full.
    expect(() => chains({ chains: [] })).toThrow(/migrateChains\.ts/);
  });

  it("no longer has a track/module collision to refuse", () => {
    // With one map a name is one node, so a `tracks:`/`modules:` collision cannot be written.
    const g = chains({ modules: { x: ["OUT"] } }, ["x"]);
    expect(Object.keys(g)).toEqual(["x"]);
    expect(g.x.from).toBe("x");
  });

  it("reads nothing as no chains", () => {
    expect(chains(null)).toEqual({});
    expect(chains({})).toEqual({});
  });
});
