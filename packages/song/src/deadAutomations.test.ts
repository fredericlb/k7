// A curve the engine would refuse becomes a project warning: a built-in's plain-state control, or a name
// the module's graph does not declare. A curve on a real automatable parameter says nothing.

import type { ProjectDoc } from "@studio/engine-protocol/project";
import { builtinParamAutomatable } from "@studio/song-schema/builtinParams";
import { describe, expect, it } from "vitest";
import { deadAutomations } from "./deadAutomations";

const doc = (plugin: Record<string, unknown>, params: string[]): ProjectDoc =>
  ({
    tracks: [
      {
        id: "t",
        plugins: [{ id: "c:m", ...plugin }],
        automation: params.map((param) => ({
          param,
          pluginId: "c:m",
          bipolar: false,
          points: [[0, 0]],
        })),
      },
    ],
  }) as unknown as ProjectDoc;

describe("builtinParamAutomatable", () => {
  it("is false for Tracktion's phaser and chorus knobs, true for an automatable one and for anything unknown", () => {
    expect(builtinParamAutomatable("Phaser", "Rate")).toBe(false);
    expect(builtinParamAutomatable("chorus", "Width")).toBe(false);
    expect(builtinParamAutomatable("4OSC", "Tune 1")).toBe(true);
    expect(builtinParamAutomatable("Some VST", "Cutoff")).toBe(true);
  });
});

describe("deadAutomations", () => {
  it("warns about a curve on a built-in's plain-state control", () => {
    const d = deadAutomations("/nowhere", doc({ type: "Phaser" }, ["Rate"]));
    expect(d).toHaveLength(1);
    expect(d[0].message).toMatch(/plain plugin state/);
    expect(d[0].severity).toBe("warning");
  });

  it("warns about a name the graph does not declare, and not about one it does", () => {
    const graph = JSON.stringify({ params: [{ name: "Depth" }], nodes: [] });
    const d = deadAutomations(
      "/nowhere",
      doc({ type: "DSP Graph", dspGraph: graph }, ["Mix", "Depth"]),
    );
    expect(d.map((x) => x.message)).toEqual([
      "a curve on 'Mix' does nothing: this module has no 'Mix' to automate (it has Depth)",
    ]);
  });
});
