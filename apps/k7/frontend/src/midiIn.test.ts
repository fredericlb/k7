// The midi-in node wired to a lane is what that lane records from — and no node, no MIDI.

import { describe, expect, it } from "vitest";
import { midiInDeviceFor, midiInLanes, midiInPlayed } from "./midiIn";
import type { WebGraph } from "./types";

const graph = (
  chains: Record<string, unknown>,
  tracks: string[] = [],
): WebGraph => ({ chains, tracks }) as unknown as WebGraph;

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

describe("which lanes arm for MIDI", () => {
  it("are the lanes a midi-in node feeds, sequence or not", () => {
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
    expect([...midiInLanes(g)]).toEqual(["lead"]);
  });
});

describe("which instruments a keyboard plays directly", () => {
  it("is each instrument a midi-in node feeds with no lane between, by the run it starts", () => {
    const g = graph(
      {
        keys: {
          from: "keys",
          use: [{ module: "keys", device: "KeyStep 37" }],
          out: [{ to: "piano#midi" }, { to: "lead" }],
        },
        piano: { use: [{ module: "piano" }], out: [{ to: "MIX" }] },
      },
      ["lead"],
    );
    // The lane is recorded through its arm, not played from here.
    expect(midiInPlayed(g)).toEqual([{ track: "piano", device: "KeyStep 37" }]);
  });

  it("is nothing where no midi-in node is wired", () => {
    const g = graph({
      mic: {
        from: "mic",
        use: [{ module: "mic", monitor: "on" }],
        out: [{ to: "comp" }],
      },
    });
    expect(midiInPlayed(g)).toEqual([]);
  });
});
