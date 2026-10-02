// The midi-in node wired to a lane is what that lane records from — and no node, no MIDI.

import { describe, expect, it } from "vitest";
import { midiInDeviceFor } from "./midiIn";
import type { WebGraph } from "./types";

const graph = (chains: Record<string, unknown>): WebGraph =>
  ({ chains }) as unknown as WebGraph;

describe("which device records into a lane", () => {
  it("is the label of the midi-in node wired to it", () => {
    const g = graph({
      keys: {
        from: "keys",
        use: [{ module: "keys", device: "KeyStep 37" }],
        out: [{ to: "lead" }],
      },
    });
    expect(midiInDeviceFor(g, "lead")).toBe("KeyStep 37");
  });

  it("is any device for a node that names none, and nothing for a lane no node feeds", () => {
    const g = graph({
      keys: {
        from: "keys",
        use: [{ module: "keys", device: "" }],
        out: [{ to: "lead" }],
      },
      mic: {
        from: "mic",
        use: [{ module: "mic", monitor: "on" }],
        out: [{ to: "vox" }],
      },
    });
    expect(midiInDeviceFor(g, "lead")).toBe("");
    expect(midiInDeviceFor(g, "vox")).toBeNull();
    expect(midiInDeviceFor(g, "bass")).toBeNull();
  });
});
