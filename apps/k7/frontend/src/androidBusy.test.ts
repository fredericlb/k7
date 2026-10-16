// What the Android app is told the engine is doing, which decides its foreground service and its screen.

import { describe, expect, it } from "vitest";
import { engineBusy, LIVE_HOLD_MS } from "./androidBusy";

const idle = { playing: false, armed: [], recordEnabled: false, recorders: {} };
const never = Number.NEGATIVE_INFINITY;

describe("engineBusy", () => {
  it("is empty for a stopped, unarmed, silent session", () => {
    expect(engineBusy(idle, never, 1000)).toEqual([]);
  });
  it("reports a rolling take as recording, armed and playing", () => {
    expect(
      engineBusy({ ...idle, playing: true, recordEnabled: true }, never, 0),
    ).toEqual(["recording", "armed", "playing"]);
  });
  it("reports an armed track with the transport stopped", () => {
    expect(engineBusy({ ...idle, armed: ["gtr"] }, never, 0)).toEqual([
      "armed",
    ]);
  });
  // A recorder node captures with the transport stopped.
  it("reports a free-running recorder as recording", () => {
    const recorders = {
      rec: { recording: true, seconds: 3, takes: [], envelope: [], from: 0 },
    };
    expect(engineBusy({ ...idle, recorders }, never, 0)).toEqual(["recording"]);
  });
  it("holds a rig live for a while after it last sounded", () => {
    expect(engineBusy(idle, 0, LIVE_HOLD_MS - 1)).toEqual(["live"]);
    expect(engineBusy(idle, 0, LIVE_HOLD_MS)).toEqual([]);
  });
});
