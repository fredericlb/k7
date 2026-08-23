import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song-schema/yaml/mixViewSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
import {
  controlDriving,
  engineAgrees,
  offlinePublish,
  resolveBindings,
  shownValue,
  stretchTargets,
  valueFor,
} from "./mixBindings";

/** A graph with one chain holding the steps given, each addressable and drawn. */
const graphWith = (
  steps: {
    module: string;
    pluginId?: string;
    // The widget's own fields, minus the placement: `curve` and `step` are what the desk must honour.
    widget?: Partial<WebWidget> & { bind: string };
  }[],
): WebGraph =>
  ({
    tracks: ["deckA"],
    trackSignals: { deckA: "audio" },
    chains: {
      deckA: {
        from: "deckA",
        use: steps.map((s) => ({
          module: s.module,
          category: "audio",
          emits: "audio",
          enabled: true,
          pluginId: s.pluginId,
          ui: s.widget
            ? {
                cols: 1,
                rows: 1,
                widgets: { w: { type: "knob", col: 0, row: 0, ...s.widget } },
              }
            : undefined,
        })),
        out: [{ to: "OUT", gain: 1 }],
      },
    },
    warnings: [],
  }) as unknown as WebGraph;

const VIEW: MixView = { crossfade: { module: "crossfade", param: "Mix" } };

/** An engine with nothing loaded — the state before a compile is sent. */
const NO_PLUGINS = new Set<string>();

describe("resolving the desk's bindings", () => {
  it("finds the plugin and the widget a control drives", () => {
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([
        {
          module: "crossfade",
          pluginId: "deckA:crossfade",
          widget: { bind: "Mix", min: 0, max: 1 },
        },
      ]),
    );
    expect(problems).toEqual([]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].pluginId).toBe("deckA:crossfade");
    expect(bindings[0].widget?.bind).toBe("Mix");
    expect(bindings[0].control.id).toBe("crossfade");
  });

  it("names a control the desk does not have", () => {
    // A typo about your OWN project: silence here would leave a dead fader with nothing to fix.
    const { bindings, problems } = resolveBindings(
      { "deckA.pitch": { module: "crossfade", param: "Mix" } },
      graphWith([{ module: "crossfade", pluginId: "x" }]),
    );
    expect(bindings).toEqual([]);
    expect(problems[0].control).toBe("deckA.pitch");
    expect(problems[0].message).toContain("pupitre");
  });

  it("names a module the chains do not have", () => {
    const { problems } = resolveBindings(
      { crossfade: { module: "crossfad", param: "Mix" } },
      graphWith([{ module: "crossfade", pluginId: "x" }]),
    );
    expect(problems[0].message).toContain("crossfad");
  });

  it("resolves a module with no plugin by the TRACK it processes", () => {
    // An `offline` module compiles to no plugin, so the track its chain draws from is the address.
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade" }]),
    );
    expect(problems).toEqual([]);
    expect(bindings[0].pluginId).toBeUndefined();
    expect(bindings[0].track).toBe("deckA");
  });

  it("names a module with neither a plugin nor a track", () => {
    // Nothing to move at all, and named rather than skipped: a dead binding must say so.
    const graph = graphWith([{ module: "crossfade" }]);
    graph.chains.deckA.from = "";
    const { bindings, problems } = resolveBindings(VIEW, graph);
    expect(bindings).toEqual([]);
    expect(problems[0].message).toContain("bouger");
  });

  it("resolves WITHOUT a widget rather than calling it broken", () => {
    // No panel means no min/max and nothing to scale — but the target exists, so it is no error.
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    expect(problems).toEqual([]);
    expect(bindings[0].widget).toBeUndefined();
  });

  it("resolves nothing at all with no graph yet", () => {
    // Before the first compile: every line is unresolvable, rather than the file looking empty.
    const { bindings, problems } = resolveBindings(VIEW, null);
    expect(bindings).toEqual([]);
    expect(problems).toHaveLength(1);
  });
});

describe("which track a fader stretches", () => {
  const tempoView: MixView = {
    "deckA.tempo": { module: "tempoA", param: "Target BPM" },
    "deckB.tempo": { module: "tempoB", param: "Target BPM" },
  };
  const twoDecks = () => {
    const g = graphWith([{ module: "tempoA" }]);
    g.chains.deckB = {
      from: "deckB",
      use: [
        { module: "tempoB", category: "audio", emits: "audio", enabled: true },
      ],
      out: [{ to: "OUT", gain: 1 }],
    } as unknown as WebGraph["chains"][string];
    return g;
  };
  const byDeck = {
    deckA: { natural: 120, seconds: 60, target: 126 },
    deckB: { natural: 90, seconds: 60, target: 90 },
  };

  it("sends each deck's fader to its own deck's track", () => {
    const { bindings } = resolveBindings(tempoView, twoDecks());
    expect(stretchTargets(bindings, byDeck, NO_PLUGINS)).toEqual({
      deckA: byDeck.deckA,
      deckB: byDeck.deckB,
    });
  });

  it("FOLLOWS the file when a fader is pointed elsewhere", () => {
    // A declared control, not a hardcoded one: deck A's fader stretches whatever module the file names.
    const crossed: MixView = {
      "deckA.tempo": { module: "tempoB", param: "Target BPM" },
    };
    const { bindings } = resolveBindings(crossed, twoDecks());
    // Deck A's fader position, landing on deck B's track.
    expect(stretchTargets(bindings, byDeck, NO_PLUGINS)).toEqual({
      deckB: byDeck.deckA,
    });
  });

  it("skips a binding whose plugin the ENGINE actually has", () => {
    // The crossfade goes the other way, so stretching its track too would apply the fade twice.
    const { bindings } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    const loaded = new Set(["deckA:crossfade"]);
    expect(stretchTargets(bindings, byDeck, loaded)).toEqual({});
  });

  it("leaves an EQ knob out of the stretches entirely", () => {
    // The EQ is a REAL plugin: in the stretch map its bass knob would warp the deck's clip.
    const { bindings } = resolveBindings(
      { "deckA.eqLow": { module: "eqA", param: "Low-shelf gain" } },
      graphWith([{ module: "eqA", pluginId: "deckA:eqA" }]),
    );
    expect(stretchTargets(bindings, byDeck, new Set(["deckA:eqA"]))).toEqual(
      {},
    );
  });

  it("STRETCHES when the graph invented an id the document has not got", () => {
    // `buildGraphDoc` gives an `offline` module a `pluginId` the compiler emits nothing for.
    const { bindings } = resolveBindings(
      { "deckA.tempo": { module: "tempoA", param: "Target BPM" } },
      graphWith([{ module: "tempoA", pluginId: "deckA:tempoA" }]),
    );
    expect(bindings[0].pluginId).toBe("deckA:tempoA");
    expect(stretchTargets(bindings, byDeck, NO_PLUGINS)).toEqual({
      deckA: byDeck.deckA,
    });
  });
});

describe("reading a binding backwards, for the graph", () => {
  const tempoView: MixView = {
    "deckA.tempo": { module: "tempoA", param: "Target BPM" },
    "deckB.tempo": { module: "tempoB", param: "Target BPM" },
  };
  const graph = () => {
    const g = graphWith([{ module: "tempoA" }]);
    g.chains.deckB = {
      from: "deckB",
      use: [
        { module: "tempoB", category: "audio", emits: "audio", enabled: true },
      ],
      out: [{ to: "OUT", gain: 1 }],
    } as unknown as WebGraph["chains"][string];
    return g;
  };

  it("finds the control a module's param belongs to", () => {
    // A node knows nothing about decks, so the file's line is read the other way — docs/deckSet.md.
    const { bindings } = resolveBindings(tempoView, graph());
    expect(controlDriving(bindings, "tempoB", "Target BPM")?.control.id).toBe(
      "deckB.tempo",
    );
  });

  it("FOLLOWS the file, so re-pointing a line moves the graph's knob too", () => {
    // Deck A's fader aimed at deck B's module: the knob on `tempoB` is now deck A's control.
    const crossed: MixView = {
      "deckA.tempo": { module: "tempoB", param: "Target BPM" },
    };
    const { bindings } = resolveBindings(crossed, graph());
    expect(controlDriving(bindings, "tempoB", "Target BPM")?.control.id).toBe(
      "deckA.tempo",
    );
  });

  it("refuses a binding that HAS a plugin", () => {
    // That one has a socket of its own, and answering would give one param two routes to the engine.
    const { bindings } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    expect(controlDriving(bindings, "crossfade", "Mix")).toBeUndefined();
  });

  it("knows nothing about a param nobody bound", () => {
    const { bindings } = resolveBindings(tempoView, graph());
    expect(controlDriving(bindings, "tempoA", "Source BPM")).toBeUndefined();
    expect(controlDriving(bindings, "nope", "Target BPM")).toBeUndefined();
  });
});

describe("what a control's position SHOWS", () => {
  const bound = () =>
    resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    ).bindings[0];
  const LIVE = { "deckA:crossfade": { Mix: 0.8 } };

  it("draws the ENGINE's value when no hand is on it", () => {
    // A per-surface copy left the graph drawing the file's number after a knob was turned in Mix.
    expect(shownValue(bound(), undefined, LIVE)).toBe(0.8);
  });

  it("lets the hand win while a gesture is in flight", () => {
    // Optimism, and only for the round trip: waiting for the engine would make every drag lag.
    expect(shownValue(bound(), 0.2, LIVE)).toBe(0.2);
  });

  it("knows nothing rather than guessing zero", () => {
    // Before the first frame: zero is a real value, and on a ±20 dB EQ it is the CENTRE.
    expect(shownValue(bound(), undefined, {})).toBeUndefined();
    expect(shownValue(undefined, undefined, LIVE)).toBeUndefined();
  });

  it("yields the override once the engine has caught up", () => {
    // An override that never yields is a control that has stopped listening.
    expect(engineAgrees(bound(), 0.8, LIVE)).toBe(true);
    expect(engineAgrees(bound(), 0.81, LIVE)).toBe(true); // within a hair
    expect(engineAgrees(bound(), 0.2, LIVE)).toBe(false);
    // Nothing heard yet is not agreement — the knob would snap back to whatever the file said.
    expect(engineAgrees(bound(), 0.8, {})).toBe(false);
  });
});

describe("what a control's position sends", () => {
  const bind = (min?: number, max?: number) =>
    resolveBindings(
      VIEW,
      graphWith([
        {
          module: "crossfade",
          pluginId: "deckA:crossfade",
          widget: { bind: "Mix", min, max },
        },
      ]),
    ).bindings[0];

  it("maps the control's range onto the WIDGET's", () => {
    // An identity here, but it goes THROUGH the widget's numbers rather than assuming they match.
    const b = bind(0, 1);
    expect(valueFor(b, 0)).toBeCloseTo(0);
    expect(valueFor(b, 0.5)).toBeCloseTo(0.5);
    expect(valueFor(b, 1)).toBeCloseTo(1);
  });

  it("expands a 0..1 control onto a param with a real range", () => {
    const b = bind(-60, 6);
    expect(valueFor(b, 0)).toBeCloseTo(-60);
    expect(valueFor(b, 1)).toBeCloseTo(6);
    expect(valueFor(b, 0.5)).toBeCloseTo(-27);
  });

  // The widget half belongs to `widgetDenorm`: a hand-rolled lerp put a log midpoint in the wrong place.
  it("follows a log widget's curve, like the graph does", () => {
    const b = resolveBindings(
      VIEW,
      graphWith([
        {
          module: "crossfade",
          pluginId: "deckA:crossfade",
          widget: { bind: "Mix", min: 20, max: 20000, curve: "log" },
        },
      ]),
    ).bindings[0];
    expect(valueFor(b, 0)).toBeCloseTo(20);
    expect(valueFor(b, 1)).toBeCloseTo(20000);
    // Geometric middle (632), not the arithmetic 10010 a lerp would give.
    expect(valueFor(b, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 0);
  });

  // …and `step` quantises, which a hand-rolled expansion also dropped.
  it("quantises to the widget's step", () => {
    const b = resolveBindings(
      VIEW,
      graphWith([
        {
          module: "crossfade",
          pluginId: "deckA:crossfade",
          widget: { bind: "Mix", min: 0, max: 10, step: 1 },
        },
      ]),
    ).bindings[0];
    expect(valueFor(b, 0.44)).toBe(4);
  });

  it("scales a control whose own range is not 0..1", () => {
    // The tempo fader is 10..300: normalise by the CONTROL's range, expand by the WIDGET's.
    const tempo = mixControl("deckA.tempo");
    if (!tempo) throw new Error("the desk defines it");
    const b = { ...bind(0, 100), control: tempo };
    expect(valueFor(b, 10)).toBeCloseTo(0);
    expect(valueFor(b, 300)).toBeCloseTo(100);
    expect(valueFor(b, 155)).toBeCloseTo(50);
  });

  it("passes the number through when there is no range to map onto", () => {
    // Inventing one would make a fader sweep a range nobody chose.
    expect(valueFor(bind(), 0.42)).toBeCloseTo(0.42);
  });
});

// What the graph is lent for the modules the engine holds nothing of — see ../docs/bpm.md.
describe("what an offline module reads", () => {
  /** A measured deck: the song runs at 128, the fader has been pulled to 124. */
  const TEMPO = { natural: 128, seconds: 210, target: 124 };
  const TEMPO_VIEW: MixView = {
    "deckA.tempo": { module: "tempoA", param: "Target BPM" },
  };
  const tempoGraph = graphWith([
    { module: "tempoA", widget: { bind: "Target BPM", min: 10, max: 300 } },
  ]);
  const bindings = resolveBindings(TEMPO_VIEW, tempoGraph).bindings;

  it("publishes BOTH of a tempo node's numbers, not just the bound one", () => {
    // One param per control is bound, so `Source BPM` — measured, drawn as a meter — is published here.
    expect(offlinePublish(bindings, { deckA: TEMPO }, "Source BPM")).toEqual([
      { module: "tempoA", param: "Target BPM", value: 124 },
      { module: "tempoA", param: "Source BPM", value: 128 },
    ]);
  });

  it("publishes 0 for a deck with no tempo rather than saying nothing", () => {
    // Silence across the gap after `clearTempo` left the node showing the OUTGOING song (docs/bpm.md).
    expect(offlinePublish(bindings, {}, "Source BPM")).toEqual([
      { module: "tempoA", param: "Target BPM", value: 0 },
      { module: "tempoA", param: "Source BPM", value: 0 },
    ]);
  });

  it("says nothing about a binding the ENGINE answers for", () => {
    // A real plugin reports itself down the socket, and two sources means the slower one sometimes wins.
    const withPlugin = resolveBindings(
      VIEW,
      graphWith([
        {
          module: "crossfade",
          pluginId: "deckA:crossfade",
          widget: { bind: "Mix", min: 0, max: 1 },
        },
      ]),
    ).bindings;
    expect(offlinePublish(withPlugin, { deckA: TEMPO }, "Source BPM")).toEqual(
      [],
    );
  });

  it("says nothing about an offline module that is NOT a tempo", () => {
    // "Every binding with no plugin" made a stem cut read its deck's BPM as its own value.
    const cutView: MixView = {
      "deckA.stemBass": { module: "stemsA", param: "Bass" },
    };
    const cut = resolveBindings(
      cutView,
      graphWith([
        { module: "stemsA", widget: { bind: "Bass", min: 0, max: 1 } },
      ]),
    ).bindings;
    expect(offlinePublish(cut, { deckA: TEMPO }, "Source BPM")).toEqual([]);
  });
});
