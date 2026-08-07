import type { WebGraph } from "@studio/graph-model";
import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
import { resolveBindings, valueFor } from "./mixBindings";

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

  it("names a module with nothing to send a value to", () => {
    // The state m9 is actually in for a cold module today: it is in the chains and has no
    // plugin in the document. The most likely reason a binding looks dead, and not the
    // file's fault — so it says so rather than dropping the line.
    const { bindings, problems } = resolveBindings(
      VIEW,
      graphWith([{ module: "crossfade" }]),
    );
    expect(bindings).toEqual([]);
    expect(problems[0].message).toContain("valeur");
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
