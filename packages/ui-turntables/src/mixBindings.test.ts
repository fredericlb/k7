import type { WebGraph, WebWidget } from "@studio/graph-model";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
import {
  controlDriving,
  engineAgrees,
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
    // The widget's own fields, minus the placement the fixture supplies. Not a narrowing of
    // three of them: `curve` and `step` are what the desk has to honour, so a fixture that
    // cannot express them cannot test that it does.
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
    // A typo about your OWN project. l8's MIDI join skips a binding it cannot apply, because
    // a module's map travels into projects that draw it differently — this file names this
    // set's own nodes, so silence would leave a dead fader with nothing to fix.
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
    // An `offline` module — m9's tempo is one — compiles to no plugin, so there is no param
    // to set. It is not unbindable: what it changes is the material of the track its chain
    // draws from, and that track is the address.
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade" }]),
    );
    expect(problems).toEqual([]);
    expect(bindings[0].pluginId).toBeUndefined();
    expect(bindings[0].track).toBe("deckA");
  });

  it("names a module with neither a plugin nor a track", () => {
    // Nothing to move at all. Named rather than skipped: "nothing happens when I move it" is
    // the most likely reason a binding looks dead, and it is not the file's fault.
    const graph = graphWith([{ module: "crossfade" }]);
    graph.chains.deckA.from = "";
    const { bindings, problems } = resolveBindings(VIEW, graph);
    expect(bindings).toEqual([]);
    expect(problems[0].message).toContain("bouger");
  });

  it("resolves WITHOUT a widget rather than calling it broken", () => {
    // No panel means no min/max, so nothing can be scaled — but the target exists, and
    // reporting it as an error would be wrong.
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    expect(problems).toEqual([]);
    expect(bindings[0].widget).toBeUndefined();
  });

  it("resolves nothing at all with no graph yet", () => {
    // Before the first compile. Every line is reported as unresolvable rather than the file
    // looking empty — which would read as "you bound nothing".
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
    // The difference between a declared control and a hardcoded one: deck A's fader stretches
    // whatever module the file names, and here that is deck B's.
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
    // The crossfade goes the other way — `setPluginParam`, not a warp. Stretching its track
    // as well would apply the fade twice, in two different currencies.
    const { bindings } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    const loaded = new Set(["deckA:crossfade"]);
    expect(stretchTargets(bindings, byDeck, loaded)).toEqual({});
  });

  it("leaves an EQ knob out of the stretches entirely", () => {
    // The EQ is a REAL plugin, so its knobs take the param path — `set-plugin-param`, per
    // pixel. Letting one into the stretch map would warp the deck's clip every time somebody
    // touched the bass, which is the same confusion of currencies the crossfade case guards.
    const { bindings } = resolveBindings(
      { "deckA.eqLow": { module: "eqA", param: "Low-shelf gain" } },
      graphWith([{ module: "eqA", pluginId: "deckA:eqA" }]),
    );
    expect(stretchTargets(bindings, byDeck, new Set(["deckA:eqA"]))).toEqual(
      {},
    );
  });

  it("STRETCHES when the graph invented an id the document has not got", () => {
    // The bug this argument exists for. `buildGraphDoc` gives an `offline` module a
    // `pluginId` — `deckA:tempoA` — and the compiler emits no such plugin. Judging by the
    // graph classed every tempo fader as a param and sent it into the void; judging by the
    // DOCUMENT is what puts it back on the warp path.
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
    // All the graph has is a module and a param — a node knows nothing about decks. The file
    // already says which control drives it, and reading the same line the other way is what
    // lets a knob turned there move the right deck.
    const { bindings } = resolveBindings(tempoView, graph());
    expect(controlDriving(bindings, "tempoB", "Target BPM")?.control.id).toBe(
      "deckB.tempo",
    );
  });

  it("FOLLOWS the file, so re-pointing a line moves the graph's knob too", () => {
    // Deck A's fader aimed at deck B's module: the knob on `tempoB` is now deck A's control,
    // and neither surface had to be told.
    const crossed: MixView = {
      "deckA.tempo": { module: "tempoB", param: "Target BPM" },
    };
    const { bindings } = resolveBindings(crossed, graph());
    expect(controlDriving(bindings, "tempoB", "Target BPM")?.control.id).toBe(
      "deckA.tempo",
    );
  });

  it("refuses a binding that HAS a plugin", () => {
    // That one has a socket of its own — the graph sends `set-plugin-param` and never asks
    // this. Answering would give one param two routes to the engine, which is how a value
    // gets applied twice.
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
    // The bug this exists for. Every surface used to keep its own copy, so a knob turned in
    // Mix left the graph drawing the number the project file declares — and the graph is
    // where you go to check what a module is actually doing.
    expect(shownValue(bound(), undefined, LIVE)).toBe(0.8);
  });

  it("lets the hand win while a gesture is in flight", () => {
    // Optimism, and only for the round trip: waiting for the engine to agree before moving
    // the knob would make every drag feel like a lag.
    expect(shownValue(bound(), 0.2, LIVE)).toBe(0.2);
  });

  it("knows nothing rather than guessing zero", () => {
    // Before the first frame. Zero is a real value — and on a ±20 dB EQ it is the CENTRE —
    // so a caller drawing the control's own home is right where inventing a 0 would not be.
    expect(shownValue(bound(), undefined, {})).toBeUndefined();
    expect(shownValue(undefined, undefined, LIVE)).toBeUndefined();
  });

  it("yields the override once the engine has caught up", () => {
    // An override that never yields is a control that has stopped listening: the engine can
    // clamp what it was sent, and the graph can move the same param.
    expect(engineAgrees(bound(), 0.8, LIVE)).toBe(true);
    expect(engineAgrees(bound(), 0.81, LIVE)).toBe(true); // within a hair
    expect(engineAgrees(bound(), 0.2, LIVE)).toBe(false);
    // Nothing heard yet is not agreement — dropping the hand's value here would snap the
    // knob back to wherever the file said.
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
    // The crossfader is 0..1 and so is Mix, so this is an identity — the case that matters is
    // that it goes through the widget's numbers rather than assuming they match.
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

  // The widget half belongs to `widgetDenorm`, not to a lerp written here. Expanded by hand,
  // a log control's midpoint landed at the ARITHMETIC middle — so the same param moved from
  // the desk and moved on the graph gave two different numbers, in one app, on one plugin.
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
    // The tempo fader is 10..300. Its middle has to land on the param's middle, which is what
    // normalising by the CONTROL's range and expanding by the WIDGET's is for.
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
