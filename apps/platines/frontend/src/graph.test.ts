import { buildGraph, layout } from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import { DECK, deckDoc } from "./deck";
import { categoryOf, type DeckModule, deckGraph } from "./graph";

const mod = (name: string, over: Partial<DeckModule> = {}): DeckModule => ({
  name,
  category: "audio",
  plugin: { type: "internal", name: "4OSC" },
  enabled: true,
  ...over,
});

describe("the deck as a WebGraph", () => {
  it("draws even with nothing loaded", () => {
    // A deck before a pick is the ordinary state, not an error one — and arranging a chain
    // BEFORE choosing a song is a thing somebody will want to do.
    const g = deckGraph(null, []);
    expect(g.tracks).toEqual([DECK]);
    expect(g.chains[DECK].out).toEqual([{ to: "OUT", gain: 1 }]);
    expect(g.warnings).toEqual([]);
  });

  it("puts the modules on the chain in order", () => {
    const g = deckGraph("Song", [mod("filter"), mod("crush")]);
    expect(g.chains[DECK].use.map((u) => u.module)).toEqual([
      "filter",
      "crush",
    ]);
  });

  it("addresses each node the way the engine will", () => {
    // Without pluginId a node is decorative: nothing can bypass it or reach its params.
    const g = deckGraph("Song", [mod("filter")]);
    expect(g.chains[DECK].use[0].pluginId).toBe(`${DECK}:filter`);
  });

  it("carries a bypassed module as disabled rather than dropping it", () => {
    const g = deckGraph("Song", [mod("filter", { enabled: false })]);
    expect(g.chains[DECK].use[0].enabled).toBe(false);
    expect(g.chains[DECK].use).toHaveLength(1);
  });
});

// The finding this step exists for. The plan expected platines to need a throwaway project
// folder to get a graph at all; WebGraph is a wire type, so the whole pipeline runs on data
// built in the browser.
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

// A graph showing a filter the engine never loaded is a picture of a signal path that does
// not exist. These two must not drift.
describe("the graph and the document agree", () => {
  it("gives a node and a plugin the SAME id", () => {
    const modules = [mod("filter"), mod("crush")];
    const g = deckGraph("Song", modules);
    const doc = deckDoc("/m/song.wav", "Song", modules);
    expect(doc.tracks[0].plugins.map((p) => p.id)).toEqual(
      g.chains[DECK].use.map((u) => u.pluginId),
    );
  });

  it("keeps the order, which is audible", () => {
    const modules = [mod("a"), mod("b"), mod("c")];
    const doc = deckDoc("/m/song.wav", "Song", modules);
    expect(doc.tracks[0].plugins.map((p) => p.name)).toEqual(["a", "b", "c"]);
  });

  it("maps the authored plugin onto the engine's wire form", () => {
    // `internal` means the NAME is the engine's type and the module name is the label —
    // getting this backwards loads nothing at all, silently.
    const doc = deckDoc("/m/song.wav", "Song", [mod("bass")]);
    expect(doc.tracks[0].plugins[0].type).toBe("4OSC");
    expect(doc.tracks[0].plugins[0].name).toBe("bass");
  });

  it("carries a bypass into the document", () => {
    const doc = deckDoc("/m/song.wav", "Song", [
      mod("filter", { enabled: false }),
    ]);
    expect(doc.tracks[0].plugins[0].enabled).toBe(false);
  });

  it("survives a module whose file had no plugin block", () => {
    // An io module, or a half-written file. It must produce a document, not throw.
    const doc = deckDoc("/m/song.wav", "Song", [
      mod("desk", { plugin: undefined }),
    ]);
    expect(doc.tracks[0].plugins).toHaveLength(1);
    expect(doc.tracks[0].plugins[0].name).toBe("desk");
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
