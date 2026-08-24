// The one property that matters: what comes back out of the bench is the chain that went in.
// Everything else here is a case where that could quietly stop being true.
//
// One `modules:` map — a lane is a module too (docs/trackModules.md) — so `@in` and the
// bench's own track sit in it beside everything else.

import { describe, expect, it } from "vitest";
import {
  benchChainCollision,
  chainFromBench,
  chainToBench,
} from "./benchChain";
import { BENCH_EDGES } from "./scaffoldBench";

// The REAL furniture: a restated copy would drift from the sink the bench declares.
const EDGES = BENCH_EDGES;

// The real thing, from the médiathèque: `chains/blindtest/assourdissant/…/graph.yaml`.
const REAL = `# Assourdissant — les effets de la question, en chaîne.
# L'ordre des modules est dans apps/z0/docs/effects.md.
modules:
  "@in": [ overdrive ]
  overdrive: [ "@out" ]
`;

const roundTrip = (text: string, edges = EDGES) =>
  chainFromBench(chainToBench(text, edges), edges);

describe("a shared chain, opened on the bench", () => {
  it("puts the material on the track and the sound through the strip", () => {
    const bench = chainToBench(REAL, EDGES);
    expect(bench).toContain("banc:");
    expect(bench).toContain("mixer:");
    expect(bench).toContain("OUT");
    // The boundary words are the shared chain's, and have no business in a project.
    expect(bench).not.toContain("@in");
    expect(bench).not.toContain("@out");
  });

  it("comes back as the chain it was", () => {
    // Structure rather than bytes: the canonical writer decides the layout, we decide the graph.
    expect(parse(roundTrip(REAL))).toEqual({
      "@in": ["overdrive"],
      overdrive: ["@out"],
    });
  });

  it("keeps the header, which is what says what the chain IS", () => {
    const back = roundTrip(REAL);
    expect(back).toContain("# Assourdissant");
    expect(back).toContain("effects.md");
  });

  it("survives a chain of several modules in order", () => {
    const src = `modules:
  "@in": [ gate ]
  gate: [ overdrive ]
  overdrive: [ eq ]
  eq: [ "@out" ]
`;
    expect(parse(roundTrip(src))).toEqual({
      "@in": ["gate"],
      gate: ["overdrive"],
      overdrive: ["eq"],
      eq: ["@out"],
    });
  });

  it("survives a split and a merge", () => {
    // Two branches meeting at the output: the parallel shape a naive rename would flatten.
    const src = `modules:
  "@in": [ dry, wet ]
  dry: [ "@out" ]
  wet: [ "@out" ]
`;
    expect(parse(roundTrip(src))).toEqual({
      "@in": ["dry", "wet"],
      dry: ["@out"],
      wet: ["@out"],
    });
  });

  it("gives a chain that treats nothing a level, and still gives it back", () => {
    // A pass-through becomes track, strip, sink, plus the project's own `MIX -> OUT` past it.
    const bench = chainToBench(`modules:\n  "@in": [ "@out" ]\n`, EDGES);
    expect(parse(bench)).toEqual({
      banc: ["mixer"],
      mixer: ["MIX"],
      MIX: ["OUT"],
    });
    expect(parse(chainFromBench(bench, EDGES))).toEqual({ "@in": ["@out"] });
  });

  it("carries `bypassed` across untouched", () => {
    const src = `modules:
  "@in": [ overdrive ]
  overdrive: [ "@out" ]
bypassed: [ overdrive ]
`;
    expect(roundTrip(src)).toContain("bypassed");
  });
});

describe("what it refuses", () => {
  it("names the collision rather than eating the module", () => {
    // A chain with its own `mixer` cannot open on a bench whose strip is one: the save deletes it.
    const src = `modules:\n  "@in": [ mixer ]\n  mixer: [ "@out" ]\n`;
    expect(benchChainCollision(src, EDGES)).toMatch(/mixer/);
    expect(benchChainCollision(REAL, EDGES)).toBeNull();
  });

  it("hands back a file it cannot parse, rather than emitting a wrong one", () => {
    const broken = "modules: [this is not the shape]\n";
    expect(chainToBench(broken, EDGES)).toBe(broken);
    expect(chainFromBench(broken, EDGES)).toBe(broken);
  });
});

// Small structural reader, so the assertions talk about the graph and not about YAML layout.
function parse(text: string): Record<string, string[]> {
  const nodes: Record<string, string[]> = {};
  let inModules = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^modules:/.test(line)) inModules = true;
    else if (/^\w/.test(line)) inModules = false;
    else if (inModules) {
      const m = /^\s+"?([^":]+)"?:\s*\[(.*)\]/.exec(line);
      if (m)
        nodes[m[1]] = m[2]
          .split(",")
          .map((d) => d.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
    }
  }
  return nodes;
}
