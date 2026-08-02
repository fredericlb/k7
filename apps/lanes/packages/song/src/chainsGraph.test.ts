import { describe, expect, it } from "vitest";
import { deriveChains, isParked } from "./chainsGraph";

// The file says who feeds whom; this says what a CHAIN is. Every rule here used to be
// carried by the shape of the old list — the head named the chain, the last node was the
// destination, and a bus was a hand-written `{ chain: … }` head. None of that is written
// down any more, so all of it has to be derived, and each rule below is one the old
// format let you state and this one has to work out.

const chains = (file: unknown) => deriveChains(file);

describe("a run, from a track to the sink", () => {
  it("follows the arrows and stops at the destination", () => {
    const g = chains({
      tracks: { "da.main": ["drum_1"] },
      modules: { drum_1: ["eq"], eq: ["OUT"] },
    });
    // The chain is called after its track, and OUT is where it goes — not a step in it.
    expect(g["da.main"]).toEqual({
      from: "da.main",
      use: [{ module: "drum_1" }, { module: "eq" }],
      out: [{ to: "OUT", gain: 1 }],
    });
    expect(Object.keys(g)).toEqual(["da.main"]);
  });

  it("carries the bypass onto the step", () => {
    const g = chains({
      tracks: { a: ["eq"] },
      modules: { eq: ["OUT"] },
      bypassed: ["eq"],
    });
    expect(g.a.use).toEqual([{ module: "eq", enabled: false }]);
  });

  it("gives a track with no modules a chain that is just its output", () => {
    const g = chains({ tracks: { a: ["OUT"] } });
    expect(g.a).toEqual({ from: "a", use: [], out: [{ to: "OUT", gain: 1 }] });
  });

  it("ignores a track that feeds nothing", () => {
    // Listing a track with an empty destination list has to mean the same as not listing
    // it, or the file grows a second way to say "not wired".
    expect(chains({ tracks: { a: [], b: ["OUT"] } })).toEqual({
      b: { from: "b", use: [], out: [{ to: "OUT", gain: 1 }] },
    });
  });
});

describe("where a run breaks", () => {
  it("breaks where two signals MEET — that is what a bus is", () => {
    const g = chains({
      tracks: { a: ["verb"], b: ["verb"] },
      modules: { verb: ["OUT"] },
    });
    // Neither track owns the reverb, so it becomes a chain of its own, named after
    // itself, and both tracks route INTO it. That is exactly the shape a hand-written
    // `{ chain: verb }` head used to produce.
    expect(g.a).toEqual({ from: "a", use: [], out: [{ to: "verb", gain: 1 }] });
    expect(g.b.out).toEqual([{ to: "verb", gain: 1 }]);
    expect(g.verb).toEqual({
      use: [{ module: "verb" }],
      out: [{ to: "OUT", gain: 1 }],
    });
  });

  it("breaks where the signal SPLITS", () => {
    const g = chains({
      tracks: { a: ["eq"] },
      modules: { eq: ["verb", "OUT"], verb: ["OUT"] },
    });
    // `eq` still belongs to the track's run; what it feeds does not, because a module the
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
    const g = chains({
      tracks: { a: ["eq"] },
      modules: { eq: ["verb", "OUT"], verb: ["tail"], tail: ["OUT"] },
    });
    expect(g.verb.use).toEqual([{ module: "verb" }, { module: "tail" }]);
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
    const g = chains({ tracks: { a: ["eq"] }, modules: { eq: ["OUT"] } });
    expect(isParked(g.a)).toBe(false);
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

  it("refuses a name that is both a track and a module", () => {
    // A chain's name is an identity — the routing target, the bus track, the prefix of
    // every plugin id under it. Two chains answering to one name would drop one set of
    // plugins on the floor, and merging them would be a guess.
    expect(() =>
      chains({ tracks: { x: ["OUT"] }, modules: { x: ["OUT"] } }),
    ).toThrow(/both a track and a module/);
  });

  it("reads nothing as no chains", () => {
    expect(chains(null)).toEqual({});
    expect(chains({})).toEqual({});
  });
});
