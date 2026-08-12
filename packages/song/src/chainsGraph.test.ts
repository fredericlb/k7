import { describe, expect, it } from "vitest";
import { deriveChains, isParked } from "./chainsGraph";

// The file says who feeds whom; this says what a CHAIN is. Every rule here used to be
// carried by the shape of the old list — the head named the chain, the last node was the
// destination, and a bus was a hand-written `{ chain: … }` head. None of that is written
// down any more, so all of it has to be derived, and each rule below is one the old
// format let you state and this one has to work out.
//
// One map now, so WHICH nodes are lanes is told rather than read off a section: only what a
// node extends says so, and the derivation has no project to ask (docs/trackModules.md).

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
    // Listing a lane with an empty destination list has to mean the same as not listing
    // it, or the file grows a second way to say "not wired".
    expect(chains({ modules: { a: [], b: ["OUT"] } }, ["a", "b"])).toEqual({
      b: { from: "b", use: [], out: [{ to: "OUT", gain: 1 }] },
    });
  });
});

describe("where a run breaks", () => {
  it("breaks where two signals MEET — that is what a bus is", () => {
    const g = chains(
      { modules: { a: ["verb"], b: ["verb"], verb: ["OUT"] } },
      ["a", "b"],
    );
    // Neither lane owns the reverb, so it becomes a chain of its own, named after
    // itself, and both lanes route INTO it. That is exactly the shape a hand-written
    // `{ chain: verb }` head used to produce.
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
    // `eq` still belongs to the lane's run; what it feeds does not, because a module the
    // split reaches is no longer on one path.
    expect(g.a.use).toEqual([{ module: "eq" }]);
    expect(g.a.out).toEqual([
      { to: "verb", gain: 1 },
      { to: "OUT", gain: 1 },
    ]);
    expect(g.verb.use).toEqual([{ module: "verb" }]);
  });

  it("does not absorb a module into a run that only sends it a share", () => {
    // The predecessor feeds two things, so even the branch nothing else touches starts
    // its own chain — otherwise a send would silently become part of the dry path.
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
    // A live interface channel routed into a lane satisfies every absorption test: one
    // feeder, feeding nothing else, and the lane goes somewhere. Absorbed, the input's run
    // would swallow the lane as its next step and the chain that OWNS the lane's material
    // would cease to exist — which is what the engine compiles the plugins onto.
    const g = chains({ modules: { "in-1": ["gtr"], gtr: ["amp"], amp: ["OUT"] } }, [
      "gtr",
    ]);
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
    // Dropping a module in before wiring it is a real state in a graph editor. It has to
    // survive the round trip, or the node disappears the moment the file is re-read.
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
    // A chain TEMPLATE has no modules folder behind it, so nothing can say `@in` is a lane.
    // It is one by name, which is the whole of what a template's source is.
    const g = chains({ modules: { "@in": ["eq"], eq: ["@out"] } });
    expect(g["@in"]).toEqual({
      from: "@in",
      use: [{ module: "eq" }],
      out: [{ to: "@out", gain: 1 }],
    });
  });

  it("keeps a cycle's modules visible instead of dropping them", () => {
    // Nothing in a cycle is a root, so the ordinary passes never reach it. Left alone the
    // modules would vanish from the graph — validate() reports the cycle, but only for
    // chains it can see.
    const g = chains({ modules: { a: ["b"], b: ["a"] } });
    expect(Object.keys(g)).toEqual(["a"]);
    expect(g.a.use.map((s) => s.module)).toEqual(["a", "b"]);
  });
});

describe("what it refuses", () => {
  it("names the old list format", () => {
    expect(() => chains({ chains: [] })).toThrow(/migrate chains/);
  });

  it("no longer has a track/module collision to refuse", () => {
    // There used to be a throw here: a name could appear in `tracks:` and in `modules:`,
    // and a chain's name is an identity — the routing target, the bus track, the prefix of
    // every plugin id under it. With one map a name is one node, so the collision cannot be
    // written down and the refusal has nothing left to guard.
    const g = chains({ modules: { x: ["OUT"] } }, ["x"]);
    expect(Object.keys(g)).toEqual(["x"]);
    expect(g.x.from).toBe("x");
  });

  it("reads nothing as no chains", () => {
    expect(chains(null)).toEqual({});
    expect(chains({})).toEqual({});
  });
});
