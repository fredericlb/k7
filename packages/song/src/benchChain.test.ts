// The one property that matters: what comes back out of the bench is the chain that went in.
// Everything else here is a case where that could quietly stop being true.

import { describe, expect, it } from "vitest";
import {
  benchChainCollision,
  chainFromBench,
  chainToBench,
} from "./benchChain";

const EDGES = { track: "banc", out: "OUT", strip: "mixer" };

// The real thing, from the médiathèque: `chains/blindtest/assourdissant/…/chains.yaml`.
const REAL = `# Assourdissant — les effets de la question, en chaîne.
# L'ordre des modules est dans apps/z0/docs/effects.md.
tracks:
  "@in": [ overdrive ]
modules:
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
    const { tracks, modules } = parse(roundTrip(REAL));
    expect(tracks).toEqual({ "@in": ["overdrive"] });
    expect(modules).toEqual({ overdrive: ["@out"] });
  });

  it("keeps the header, which is what says what the chain IS", () => {
    const back = roundTrip(REAL);
    expect(back).toContain("# Assourdissant");
    expect(back).toContain("effects.md");
  });

  it("survives a chain of several modules in order", () => {
    const src = `tracks:
  "@in": [ gate ]
modules:
  gate: [ overdrive ]
  overdrive: [ eq ]
  eq: [ "@out" ]
`;
    const { tracks, modules } = parse(roundTrip(src));
    expect(tracks).toEqual({ "@in": ["gate"] });
    expect(modules).toEqual({
      gate: ["overdrive"],
      overdrive: ["eq"],
      eq: ["@out"],
    });
  });

  it("survives a split and a merge", () => {
    // Two branches from the input, meeting again at the output — the shape a parallel treatment
    // has, and the one a naive rename would flatten.
    const src = `tracks:
  "@in": [ dry, wet ]
modules:
  dry: [ "@out" ]
  wet: [ "@out" ]
`;
    const { tracks, modules } = parse(roundTrip(src));
    expect(tracks).toEqual({ "@in": ["dry", "wet"] });
    expect(modules).toEqual({ dry: ["@out"], wet: ["@out"] });
  });

  it("gives a chain that treats nothing a level, and still gives it back", () => {
    // `@in → @out` is a pass-through. On the bench that is the track into the strip into the
    // sink — you get a fader over material that is otherwise untouched, which is the useful
    // reading — and the strip comes back out as the boundary it stood for.
    const bench = chainToBench(`tracks:\n  "@in": [ "@out" ]\n`, EDGES);
    expect(parse(bench)).toEqual({
      tracks: { banc: ["mixer"] },
      modules: { mixer: ["OUT"] },
    });
    const { tracks, modules } = parse(chainFromBench(bench, EDGES));
    expect(tracks).toEqual({ "@in": ["@out"] });
    expect(modules).toEqual({});
  });

  it("carries `bypassed` across untouched", () => {
    const src = `tracks:
  "@in": [ overdrive ]
modules:
  overdrive: [ "@out" ]
bypassed: [ overdrive ]
`;
    expect(roundTrip(src)).toContain("bypassed");
  });
});

describe("what it refuses", () => {
  it("names the collision rather than eating the module", () => {
    // A chain with its own `mixer` cannot be opened on a bench whose strip is `mixer`: saving
    // would take the strip out and remove the chain's module with it.
    const src = `tracks:\n  "@in": [ mixer ]\nmodules:\n  mixer: [ "@out" ]\n`;
    expect(benchChainCollision(src, EDGES)).toMatch(/mixer/);
    expect(benchChainCollision(REAL, EDGES)).toBeNull();
  });

  it("hands back a file it cannot parse, rather than emitting a wrong one", () => {
    const broken = "tracks: [this is not the shape]\n";
    expect(chainToBench(broken, EDGES)).toBe(broken);
    expect(chainFromBench(broken, EDGES)).toBe(broken);
  });
});

// Small structural reader, so the assertions talk about the graph and not about YAML layout.
function parse(text: string): {
  tracks: Record<string, string[]>;
  modules: Record<string, string[]>;
} {
  const tracks: Record<string, string[]> = {};
  const modules: Record<string, string[]> = {};
  let section: "tracks" | "modules" | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^tracks:/.test(line)) section = "tracks";
    else if (/^modules:/.test(line)) section = "modules";
    else if (/^\w/.test(line)) section = null;
    else {
      const m = /^\s+"?([^":]+)"?:\s*\[(.*)\]/.exec(line);
      if (m && section) {
        const dests = m[2]
          .split(",")
          .map((d) => d.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        (section === "tracks" ? tracks : modules)[m[1]] = dests;
      }
    }
  }
  return { tracks, modules };
}
