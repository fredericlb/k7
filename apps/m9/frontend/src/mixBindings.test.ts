import type { WebGraph } from "@studio/graph-model";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
import { resolveBindings, stretchTargets, valueFor } from "./mixBindings";

/** A graph with one chain holding the steps given, each addressable and drawn. */
const graphWith = (
  steps: {
    module: string;
    pluginId?: string;
    widget?: { bind: string; min?: number; max?: number };
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
    // set's own instances, so silence would leave a dead fader with nothing to fix.
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
    expect(stretchTargets(bindings, byDeck)).toEqual({
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
    expect(stretchTargets(bindings, byDeck)).toEqual({ deckB: byDeck.deckA });
  });

  it("skips a binding that has a real param to set", () => {
    // The crossfade goes the other way — `setPluginParam`, not a warp. Stretching its track
    // as well would apply the fade twice, in two different currencies.
    const { bindings } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade", pluginId: "deckA:crossfade" }]),
    );
    expect(stretchTargets(bindings, byDeck)).toEqual({});
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
