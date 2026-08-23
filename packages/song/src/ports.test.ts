// A module with more than one input, and the chains syntax that feeds the extra ones.
//
// A chain carries ONE signal, so a second input has to arrive from somewhere else: a destination
// names the port it lands on (`crossfade#b`) and the derivation records it on the step as `in`,
// where validate() checks it against the module's port list. See docs/ports.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { portRef, splitPort } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveChains } from "./chainsGraph";
import { loadGraph } from "./graph";
import { loadModules } from "./loader";
import { compileNodeProject } from "./nodeProject";

let dir: string;

function file(rel: string, body: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

/** A two-in crossfade, declared by the MODULE rather than by its type folder. */
const CROSSFADE = `plugin: {type: jsdsp}
inputs:
  - { name: a, type: audio }
  - { name: b, type: audio, mandatory: false }
outputs:
  - { name: out, type: audio }
params:
  mix: 0.5
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-ports-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a port ref", () => {
  it("splits on the LAST separator, leaving every other one alone", () => {
    // A ref carries three axes at once — namespace/category, node, port — and they must not
    // eat each other. `#` was chosen precisely because `:` and `/` were already spoken for.
    expect(splitPort("crossfade#b")).toEqual({ node: "crossfade", port: "b" });
    expect(splitPort("@st0/audio/crossfade:live#b")).toEqual({
      node: "@st0/audio/crossfade:live",
      port: "b",
    });
    expect(splitPort("crossfade")).toEqual({ node: "crossfade" });
  });

  it("treats a half-written ref as a plain name rather than guessing", () => {
    // `x#` is a typo with no reading; inventing an empty port from it would put a node called
    // `x` on a port called nothing, which nothing downstream could match.
    expect(splitPort("x#")).toEqual({ node: "x#" });
    expect(portRef("x")).toBe("x");
    expect(portRef("x", "b")).toBe("x#b");
  });

  it("is refused by the schema when either half is empty", () => {
    expect(() => deriveChains({ modules: { a: ["#b"] } })).toThrow(/port ref/);
  });
});

describe("a module's own ports", () => {
  it("override the type folder's defaults", () => {
    file("modules/audio/crossfade/module.yaml", CROSSFADE);
    const m = loadModules(dir).crossfade;
    expect(m.inputs).toEqual([
      { name: "a", type: "audio" },
      { name: "b", type: "audio", mandatory: false },
    ]);
    expect(m.outputs).toEqual([{ name: "out", type: "audio" }]);
  });

  it("leave a module that declares none with its type's", () => {
    // Every module written before this existed, which is the case that must not move.
    file(
      "modules/audio/amp/module.yaml",
      "plugin: {type: internal, name: Chorus}\n",
    );
    const m = loadModules(dir).amp;
    expect(m.inputs).toEqual([{ name: "in", type: "audio" }]);
    expect(m.outputs).toEqual([{ name: "out", type: "audio" }]);
  });
});

describe("wiring a named port", () => {
  it("records the feeder on the step, not as the flow", () => {
    const derived = deriveChains(
      {
        modules: {
          deckA: ["crossfade"],
          deckB: ["crossfade#b"],
          crossfade: ["OUT"],
        },
      },
      (n) => n === "deckA" || n === "deckB",
    );
    // deckA FLOWS in, so the crossfade continues deckA's run — one flow feeder is exactly the
    // absorption rule, and a side input must not change it. deckB arrives on port `b` and is
    // carried as an extra source on the step.
    expect(derived.deckA.use).toEqual([{ module: "crossfade", in: ["deckB"] }]);
    expect(derived.deckA.out).toEqual([{ to: "OUT", gain: 1 }]);
    // …and the edge keeps its port, so a renderer can draw the cable to the right jack.
    expect(derived.deckB.out).toEqual([{ to: "crossfade#b", gain: 1 }]);
    // There is no chain NAMED crossfade: it is a step inside deckA's, not a meeting point.
    expect(derived.crossfade).toBeUndefined();
  });

  it("does not let a side input absorb the module into that run", () => {
    // The trap: a run whose only destination names a port would otherwise swallow the target as
    // its next STEP, and the module's real flow input would go unnoticed.
    const derived = deriveChains(
      { modules: { deckB: ["crossfade#b"], crossfade: ["OUT"] } },
      (n) => n === "deckB",
    );
    expect(derived.deckB.use).toEqual([]); // deckB's run ends at the port
    expect(derived.crossfade.use[0].module).toBe("crossfade");
  });

  it("unions the destinations of a module keyed with a port on the source side", () => {
    // `deck#cue: [...]` is the same module as `deck: [...]`. Keying on the raw string would have
    // split one module into two nodes that never met.
    const derived = deriveChains({
      modules: { deck: ["OUT"], "deck#cue": ["phones"], phones: [] },
    });
    expect(derived.deck.out.map((o) => o.to).sort()).toEqual(["OUT", "phones"]);
    expect(Object.keys(derived).sort()).toEqual(["deck", "phones"]);
    // …but the union costs the module's identity only, not the cable's origin: this used to be
    // the place the source jack was forgotten, and the two edges read the same.
    expect(derived.deck.out.find((o) => o.to === "phones")?.fromPort).toBe(
      "cue",
    );
    expect(
      derived.deck.out.find((o) => o.to === "OUT")?.fromPort,
    ).toBeUndefined();
  });

  it("ends the run at a module that splits across its own outputs", () => {
    // A separator keyed once per stem is FOUR keys of one destination each. Counting the
    // out-degree per key would call every edge an only child and absorb all four targets into
    // one run through a module that in fact splits.
    const derived = deriveChains({
      modules: {
        "sep#drums": ["gate"],
        "sep#vocals": ["reverb"],
        gate: ["OUT"],
        reverb: ["OUT"],
      },
    });
    expect(derived.sep.use.map((s) => s.module)).toEqual(["sep"]);
    expect(derived.sep.out.map((o) => [o.fromPort, o.to]).sort()).toEqual([
      ["drums", "gate"],
      ["vocals", "reverb"],
    ]);
    // Each target starts a chain of its own rather than being swallowed by sep's run.
    expect(Object.keys(derived).sort()).toEqual(["gate", "reverb", "sep"]);
  });
});

describe("what validate says", () => {
  const wire = (yaml: string) => {
    file("modules/audio/crossfade/module.yaml", CROSSFADE);
    file("nodes/a.yaml", 'extends: "@studio/track"\nevents: []\n');
    file("nodes/b.yaml", 'extends: "@studio/track"\nevents: []\n');
    writeFileSync(join(dir, "graph.yaml"), yaml, "utf8");
    return loadGraph(dir);
  };

  it("accepts both inputs fed, and says nothing at all", () => {
    // Every warning, not just the ones mentioning a port. Filtering to /port|input/ hid two: a
    // destination naming a jack read as "not a chain or io sink", and the deck feeding it read
    // as a dead end — because the walk over `out` edges keyed on the raw string. A song that is
    // correct has to be silent, or the warning list stops being worth reading.
    const g = wire(
      "modules:\n  a: [ crossfade ]\n  b: [ crossfade#b ]\n  crossfade: [ OUT ]\n",
    );
    expect(g.warnings).toEqual([]);
  });

  it("follows a side input through to the sink, and back for a cycle", () => {
    // A port destination lands on a step INSIDE another run, so both graph walks have to carry on
    // in that run: `reachesSink` to know the deck is not a dead end, `hasCycle` because a loop
    // drawn with side inputs is exactly as unplayable as one drawn with bare ones.
    const g = wire(
      "modules:\n  a: [ crossfade ]\n  b: [ crossfade#b ]\n  crossfade: [ OUT ]\n",
    );
    expect(
      g.warnings.filter((m) => /dead end|reaches OUT|cycle/.test(m)),
    ).toEqual([]);
  });

  it("carries the side input to the engine as the TRACK feeding it", () => {
    // The engine routes a second signal from a LANE, so the chain the file names is resolved down to the
    // track it compiles onto — here `b`, whose chain ends at the port. Without this the module reached the
    // engine looking exactly like a one-input effect, and the second cable existed only in the drawing.
    wire(
      "modules:\n  a: [ crossfade ]\n  b: [ crossfade#b ]\n  crossfade: [ OUT ]\n",
    );
    const doc = compileNodeProject(dir);
    const p = doc.tracks
      .flatMap((t) => t.plugins)
      .find((x) => x.id.endsWith(":crossfade"));
    expect(p?.sidechainFrom).toBe("b");
    // …and it rides on the plugin of the track the FLOW comes from, not on the side input's own lane.
    expect(doc.tracks.find((t) => t.id === "a")?.plugins).toHaveLength(1);
    expect(doc.tracks.find((t) => t.id === "b")?.plugins).toEqual([]);
  });

  it("leaves an unwired port off the wire entirely", () => {
    // `mandatory: false` — one side fed and the other quiet is a state, not a half-built chain, and the
    // engine has to be able to tell it apart from a source it failed to resolve.
    wire("modules:\n  a: [ crossfade ]\n  crossfade: [ OUT ]\n");
    const p = compileNodeProject(dir)
      .tracks.flatMap((t) => t.plugins)
      .find((x) => x.id.endsWith(":crossfade"));
    expect(p?.sidechainFrom).toBeUndefined();
  });

  it("refuses more sources than the module has ports", () => {
    // A port arity error THROWS rather than warning: a chain wired to a port that is not there
    // is not a song that plays imperfectly, it is one the compiler cannot lay out at all.
    file("nodes/c.yaml", 'extends: "@studio/track"\nevents: []\n');
    expect(() =>
      wire(
        "modules:\n  a: [ crossfade ]\n  b: [ crossfade#b ]\n  c: [ crossfade#b ]\n  crossfade: [ OUT ]\n",
      ),
    ).toThrow(/only 2 port/);
  });
});

describe("the crossfade-demo song", () => {
  // The shipped demo, read from disk rather than from a fixture: it is what a first-time user
  // opens (file-service mirrors every folder here into their Examples workspace), so it is the
  // one crossfade that has to survive a change to any layer between YAML and the engine.
  const SONG = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "engine",
    "capot",
    "songs",
    "crossfade-demo.st0",
  );

  it("opens clean", () => {
    expect(loadGraph(SONG).warnings).toEqual([]);
  });

  it("compiles both decks into one module", () => {
    const doc = compileNodeProject(SONG);
    const deckA = doc.tracks.find((t) => t.id === "deckA");
    const deckB = doc.tracks.find((t) => t.id === "deckB");
    // deckA FLOWS in, so the module rides on its lane; deckB arrives on the port, so its lane
    // runs nothing and is named as the second input instead.
    expect(deckA?.plugins.map((p) => p.type)).toEqual(["DSP Graph"]);
    expect(deckA?.plugins[0].sidechainFrom).toBe("deckB");
    expect(deckB?.plugins).toEqual([]);
    // Muted, and the demo is wrong without it: `out` is a parallel path, so an unmuted deck B
    // reaches the master raw as well as through the module, and Mix at 0 would still play it.
    // Tracktion's muting node still feeds sidechains, which is what makes this work at all.
    expect(deckB?.mute).toBe(true);
    // The graph the engine is handed reads two ports — the module's `inputs:` and its DSP agree.
    const nodes = JSON.parse(deckA?.plugins[0].dspGraph ?? "{}").nodes as {
      type: string;
      port?: number;
    }[];
    expect(
      nodes.filter((n) => n.type === "ain").map((n) => n.port ?? 0),
    ).toEqual([0, 1]);
  });
});
