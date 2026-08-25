import { buildGraph, layout } from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import { DECKS, deckDoc, levelId, NO_LOADS, PLATTER_TYPE } from "./deck";
import { categoryOf, type DeckModule, deckGraph } from "./graph";

const mod = (name: string, over: Partial<DeckModule> = {}): DeckModule => ({
  name,
  category: "audio",
  plugin: { type: "internal", name: "4OSC" },
  enabled: true,
  ...over,
});

/** Deck A's MODULE plugins — everything before the level, which is not a step in the signal path. */
const deckAModules = (modules: DeckModule[]) => {
  const doc = deckDoc(
    {
      ...NO_LOADS,
      deckA: {
        path: "/m/song.wav",
        title: "Song",
        artist: null,
        id: "songs/s",
      },
    },
    0.5,
    { deckA: modules },
  );
  const plugins = doc.tracks[0].plugins;
  expect(plugins.at(-1)?.id).toBe(levelId("deckA"));
  // The PLATTER is the source rather than a step, so it is dropped like the level — docs/turntable.md.
  return plugins.slice(0, -1).filter((p) => p.type !== PLATTER_TYPE);
};

describe("the deck as a WebGraph", () => {
  it("draws even with nothing loaded", () => {
    // A deck before a pick is ordinary, and a chain gets arranged BEFORE a song is chosen.
    const g = deckGraph(null, []);
    expect(g.tracks).toEqual([DECKS[0]]);
    expect(g.chains[DECKS[0]].out).toEqual([{ to: "OUT", gain: 1 }]);
    expect(g.warnings).toEqual([]);
  });

  it("puts the modules on the chain in order", () => {
    const g = deckGraph("Song", [mod("filter"), mod("crush")]);
    expect(g.chains[DECKS[0]].use.map((u) => u.module)).toEqual([
      "filter",
      "crush",
    ]);
  });

  it("addresses each node the way the engine will", () => {
    // Without pluginId a node is decorative: nothing can bypass it or reach its params.
    const g = deckGraph("Song", [mod("filter")]);
    expect(g.chains[DECKS[0]].use[0].pluginId).toBe(`${DECKS[0]}:filter`);
  });

  it("carries a bypassed module as disabled rather than dropping it", () => {
    const g = deckGraph("Song", [mod("filter", { enabled: false })]);
    expect(g.chains[DECKS[0]].use[0].enabled).toBe(false);
    expect(g.chains[DECKS[0]].use).toHaveLength(1);
  });
});

// `WebGraph` is a WIRE type, so the whole pipeline runs on data built in the browser — no folder.
describe("no compiler, no project folder", () => {
  it("lays out a browser-built graph through the shared pipeline", () => {
    const { nodes, edges } = buildGraph(deckGraph("Song", [mod("filter")]));
    const laid = layout(nodes, edges);
    expect(laid.nodes.length).toBeGreaterThan(0);
    // Every node got real geometry — which is what DomChains draws from.
    for (const n of laid.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("draws the track, the module and the sink", () => {
    const { nodes } = buildGraph(deckGraph("Song", [mod("filter")]));
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toContain("track");
    expect(kinds).toContain("module");
    expect(kinds).toContain("sink");
  });
});

// A graph showing a filter the engine never loaded pictures a signal path that does not exist.
describe("the graph and the document agree", () => {
  it("gives a node and a plugin the SAME id", () => {
    const modules = [mod("filter"), mod("crush")];
    const g = deckGraph("Song", modules);
    expect(deckAModules(modules).map((p) => p.id)).toEqual(
      g.chains[DECKS[0]].use.map((u) => u.pluginId),
    );
  });

  it("keeps the order, which is audible", () => {
    const modules = [mod("a"), mod("b"), mod("c")];
    expect(deckAModules(modules).map((p) => p.name)).toEqual(["a", "b", "c"]);
  });

  it("maps the authored plugin onto the engine's wire form", () => {
    // `internal` means the NAME is the engine's type: backwards, it loads nothing at all, silently.
    const plugins = deckAModules([mod("bass")]);
    expect(plugins[0].type).toBe("4OSC");
    expect(plugins[0].name).toBe("bass");
  });

  it("carries a bypass into the document", () => {
    expect(deckAModules([mod("filter", { enabled: false })])[0].enabled).toBe(
      false,
    );
  });

  it("survives a module whose file had no plugin block", () => {
    // An io module, or a half-written file. It must produce a document, not throw.
    const plugins = deckAModules([mod("desk", { plugin: undefined })]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("desk");
  });
});

describe("reading a module's type folder", () => {
  it("takes the folder under modules/", () => {
    expect(categoryOf("modules/instruments/synth")).toBe("instruments");
    expect(categoryOf("modules/io/in")).toBe("io");
  });

  it("falls back rather than inventing a category the graph cannot draw", () => {
    expect(categoryOf("modules/whatever/thing")).toBe("audio");
    expect(categoryOf("nonsense")).toBe("audio");
  });
});
