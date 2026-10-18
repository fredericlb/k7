// desktopEngine.test.ts — the audio ranking as the desktop engine's page draws and sends it.

import { describe, expect, it } from "vitest";
import {
  idleAsioDriver,
  instrumentAction,
  instrumentRows,
  moveDevice,
  rankedDevices,
  sizeOf,
} from "./desktopEngine";

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

  it("carries the open device's channel counts, 0 on the others", () => {
    const counted = {
      ...snapshot,
      audioDevices: [
        { ...snapshot.audioDevices[0], inputs: 2, outputs: 2 },
        snapshot.audioDevices[1],
      ],
    };
    expect(
      rankedDevices(counted).map((d) => [d.name, d.inputs, d.outputs]),
    ).toEqual([
      ["MOTU", 0, 0],
      ["Built-in", 2, 2],
      ["Scarlett", 0, 0],
    ]);
  });

  it("names an ASIO driver the engine is not on, and none once it is", () => {
    const windows = (asioCurrent: boolean) => ({
      ...snapshot,
      audioDevices: [
        {
          name: "Focusrite USB ASIO",
          deviceType: "ASIO",
          current: asioCurrent,
          currentInput: asioCurrent,
        },
        {
          name: "Speakers (Focusrite USB Audio)",
          deviceType: "Windows Audio",
          current: !asioCurrent,
          currentInput: !asioCurrent,
        },
      ],
    });
    expect(idleAsioDriver(windows(false))).toBe("Focusrite USB ASIO");
    expect(idleAsioDriver(windows(true))).toBeNull();
    expect(idleAsioDriver(snapshot)).toBeNull();
  });

  it("sends the whole list in its new order on a move", () => {
    expect(moveDevice(["MOTU", "Built-in", "Scarlett"], 2, 0)).toEqual([
      "Scarlett",
      "MOTU",
      "Built-in",
    ]);
  });
});

describe("the instruments", () => {
  const s = {
    ...snapshot,
    instruments: [
      {
        name: "piano",
        label: "Piano",
        bytes: 748e6,
        wanted: true,
        installed: false,
      },
      {
        name: "drums",
        label: "Drums",
        bytes: 1.3e9,
        wanted: true,
        installed: true,
      },
      {
        name: "clav",
        label: "Clavinet",
        bytes: 8e6,
        wanted: false,
        installed: false,
      },
    ],
    downloads: [
      {
        name: "piano",
        received: 1e6,
        total: 748e6,
        phase: "downloading" as const,
      },
    ],
  };

  it("joins each instrument with its download, and offers the one action that fits", () => {
    const rows = instrumentRows(s);
    expect(
      rows.map((r) => [r.name, r.phase, instrumentAction(r)?.label ?? null]),
    ).toEqual([
      ["piano", "downloading", null],
      ["drums", null, "remove"],
      ["clav", null, "download"],
    ]);
    expect(instrumentAction({ ...rows[0], phase: "queued" })?.cmd).toBe(
      "instruments.remove",
    );
    expect(instrumentAction({ ...rows[0], phase: "failed" })?.label).toBe(
      "retry",
    );
  });

  it("says a size the way a download costs it", () => {
    expect(sizeOf(748e6)).toBe("748 MB");
    expect(sizeOf(1.3e9)).toBe("1.3 GB");
    expect(sizeOf(10)).toBe("1 MB");
  });
});
