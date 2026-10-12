// desktopEngine.test.ts — the audio ranking as the desktop engine's page draws and sends it.

import { describe, expect, it } from "vitest";
import { moveDevice, rankedDevices } from "./desktopEngine";

const snapshot = {
  status: "running" as const,
  userStopped: false,
  engineId: "e",
  enginePort: 8766,
  lastHeartbeatOk: true,
  audioDevices: [
    {
      name: "Built-in",
      deviceType: "CoreAudio",
      current: true,
      currentInput: true,
    },
    {
      name: "Scarlett",
      deviceType: "CoreAudio",
      current: false,
      currentInput: false,
    },
  ],
  audioPriority: ["MOTU", "Built-in"],
};

describe("the audio ranking", () => {
  it("lists the ranked names first, an unplugged one kept, then the devices not ranked", () => {
    expect(
      rankedDevices(snapshot).map((d) => [
        d.name,
        d.present,
        d.ranked,
        d.current,
      ]),
    ).toEqual([
      ["MOTU", false, true, false],
      ["Built-in", true, true, true],
      ["Scarlett", true, false, false],
    ]);
  });

  it("sends the whole list in its new order on a move", () => {
    expect(moveDevice(["MOTU", "Built-in", "Scarlett"], 2, 0)).toEqual([
      "Scarlett",
      "MOTU",
      "Built-in",
    ]);
  });
});
