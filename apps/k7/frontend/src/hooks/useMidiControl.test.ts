import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { ccKey, splitCcKey } from "../midiControl";
import { mappedParams } from "./useMidiControl";

// Joining a module's MIDI map to the graph it is drawn in — keyed by the widget's `bind`, so this is a join on one string.

const graph = (steps: Record<string, unknown>[], chain = "lead"): WebGraph =>
  ({
    chains: { [chain]: { use: steps, out: [] } },
    tracks: [],
    trackColors: {},
    curves: {},
    warnings: [],
  }) as unknown as WebGraph;

const knob = (bind: string, min = 0, max = 1) => ({
  type: "knob",
  col: 0,
  row: 0,
  bind,
  min,
  max,
});

describe("mappedParams", () => {
  it("pairs a binding with the widget that gives it a range", () => {
    const g = graph([
      {
        module: "filter",
        pluginId: "lead:filter",
        cc: { Cutoff: { ch: 1, cc: 74 } },
        ui: { cols: 2, rows: 1, widgets: { w1: knob("Cutoff", 20, 20000) } },
      },
    ]);
    expect(mappedParams(g)).toEqual([
      {
        module: "filter",
        param: "Cutoff",
        widget: knob("Cutoff", 20, 20000),
        pluginId: "lead:filter",
        ch: 1,
        cc: 74,
      },
    ]);
  });

  it("drops a binding whose param has no widget", () => {
    // Without min/max there is no way to turn 0..127 into a value, and the map travels with the module — so this is a normal state.
    const g = graph([
      {
        module: "filter",
        pluginId: "lead:filter",
        cc: { Cutoff: { ch: 1, cc: 74 } },
        ui: { cols: 1, rows: 1, widgets: { w1: knob("Resonance") } },
      },
    ]);
    expect(mappedParams(g)).toEqual([]);
  });

  it("drops a step with no plugin — there is nothing to send a value to", () => {
    const g = graph([
      {
        module: "filter",
        cc: { Cutoff: { ch: 1, cc: 74 } },
        ui: { cols: 1, rows: 1, widgets: { w1: knob("Cutoff") } },
      },
    ]);
    expect(mappedParams(g)).toEqual([]);
  });

  it("maps the SAME module in two chains twice — one control plays both", () => {
    // The map is the module's, and each chain has its own instance of the plugin — the documented consequence, not a bug.
    const step = {
      module: "filter",
      cc: { Cutoff: { ch: 1, cc: 74 } },
      ui: { cols: 1, rows: 1, widgets: { w1: knob("Cutoff") } },
    };
    const g = {
      chains: {
        a: { use: [{ ...step, pluginId: "a:filter" }], out: [] },
        b: { use: [{ ...step, pluginId: "b:filter" }], out: [] },
      },
      tracks: [],
      trackColors: {},
      curves: {},
      warnings: [],
    } as unknown as WebGraph;
    expect(mappedParams(g).map((m) => m.pluginId)).toEqual([
      "a:filter",
      "b:filter",
    ]);
  });

  it("has nothing to map before the graph has loaded", () => {
    expect(mappedParams(null)).toEqual([]);
  });
});

describe("ccKey", () => {
  it("round-trips a param whose name has spaces", () => {
    // A plugin names its params 'Filter Freq', and a ':' join would be ambiguous too, since a param name may contain one.
    const k = ccKey("synth", "Filter Freq");
    expect(splitCcKey(k)).toEqual({ module: "synth", param: "Filter Freq" });
  });

  it("keeps two params of one module apart", () => {
    expect(ccKey("synth", "Cutoff")).not.toBe(ccKey("synth", "Resonance"));
  });
});
