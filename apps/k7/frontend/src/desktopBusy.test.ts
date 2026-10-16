// desktopBusy.test.ts — what a frame says the transport is doing, as the desktop app's quit confirm reads it.

import type { EngineState, RecorderState } from "@studio/engine-protocol";
import { describe, expect, it } from "vitest";
import { busyOf } from "./desktopBusy";

const IDLE = {
  playing: false,
  playhead: 0,
  levels: [],
  inputLevels: [],
  armed: [],
  recordEnabled: false,
  master: -100,
  masterClipped: false,
  waveform: {},
  platters: {},
  recorders: {},
} as unknown as EngineState;

describe("busyOf", () => {
  it("is null when stopped", () => {
    expect(busyOf(IDLE)).toBeNull();
  });

  it("says playing", () => {
    expect(busyOf({ ...IDLE, playing: true })).toBe("playing");
  });

  it("says recording for an armed track rolling, or a recorder node taking", () => {
    expect(
      busyOf({ ...IDLE, playing: true, recordEnabled: true, armed: ["t"] }),
    ).toBe("recording");
    const rec = { recording: true } as RecorderState;
    expect(busyOf({ ...IDLE, recorders: { r: rec } })).toBe("recording");
  });
});
