// A lane has an input when an audio input or a MIDI device feeds it, however many chains away.

import { describe, expect, it } from "vitest";
import { laneHasInput } from "./laneInput";
import type { WebGraph } from "./types";

const graph = (chains: Record<string, unknown>): WebGraph =>
  ({ chains }) as unknown as WebGraph;

describe("whether a lane has an input", () => {
  it("is yes for a MIDI device or an audio input wired straight to it", () => {
    const g = graph({
      keys: { use: [{ module: "k", device: "" }], out: [{ to: "lead" }] },
      mic: { use: [{ module: "m", monitor: "on" }], out: [{ to: "vox" }] },
    });
    expect(laneHasInput(g, "lead")).toBe(true);
    expect(laneHasInput(g, "vox")).toBe(true);
  });

  it("is yes through a preamp's chain, and no for a lane fed by a plugin alone", () => {
    const g = graph({
      mic: { use: [{ module: "m", monitor: "auto" }], out: [{ to: "pre" }] },
      pre: { use: [{ module: "pre" }], out: [{ to: "vox" }] },
      synth: { use: [{ module: "osc" }], out: [{ to: "pad" }] },
      bass: { from: "bass", use: [{ module: "amp" }], out: [{ to: "MIX" }] },
    });
    expect(laneHasInput(g, "vox")).toBe(true);
    expect(laneHasInput(g, "pad")).toBe(false);
    expect(laneHasInput(g, "bass")).toBe(false);
  });
});
