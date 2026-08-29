// The two rules that decide whether a picture lane is on screen. Both fail silently: a solo that
// does not hide the rest reads as "solo is broken", and a lens left open on `off` keeps the
// camera's indicator lit on a layer nobody is drawing.

import { describe, expect, it } from "vitest";
import {
  anyPictureSolo,
  laneHidden,
  lensOpen,
  type MixLane,
} from "./pictureMix";

const lane = (over: Partial<MixLane> & { id: string }): MixLane => ({
  mute: false,
  solo: false,
  ...over,
});

describe("the mute / solo fold", () => {
  const lanes = [lane({ id: "main" }), lane({ id: "pip" })];

  it("hides nothing while nothing is soloed", () => {
    expect(anyPictureSolo(lanes)).toBe(false);
    expect(lanes.map((l) => laneHidden(lanes, l, null))).toEqual([
      false,
      false,
    ]);
  });

  it("hides a muted lane", () => {
    const l = [lane({ id: "main", mute: true }), lane({ id: "pip" })];
    expect(laneHidden(l, l[0], null)).toBe(true);
  });

  it("hides every UN-soloed lane once one is soloed", () => {
    const l = [lane({ id: "main" }), lane({ id: "pip", solo: true })];
    expect(laneHidden(l, l[0], null)).toBe(true);
    expect(laneHidden(l, l[1], null)).toBe(false);
  });

  it("keeps mute over solo — a soloed lane muted on its own stays hidden", () => {
    const l = [lane({ id: "pip", solo: true, mute: true })];
    expect(laneHidden(l, l[0], null)).toBe(true);
  });
});

describe("when a lens opens", () => {
  it("never on off, always on on", () => {
    const off = lane({ id: "cam", camera: "", cameraMonitor: "off" });
    const on = lane({ id: "cam", camera: "", cameraMonitor: "on" });
    expect(lensOpen(off, "cam")).toBe(false);
    expect(lensOpen(on, null)).toBe(true);
  });

  it("on auto, only while ITS lane is armed", () => {
    const l = lane({ id: "cam", camera: "", cameraMonitor: "auto" });
    expect(lensOpen(l, null)).toBe(false);
    expect(lensOpen(l, "other")).toBe(false);
    expect(lensOpen(l, "cam")).toBe(true);
  });

  it("defaults to on — a lens has no feedback path, and a camera node has always shown", () => {
    expect(lensOpen(lane({ id: "cam", camera: "" }), null)).toBe(true);
  });

  it("answers false for a lane with no lens at all", () => {
    expect(lensOpen(lane({ id: "main" }), "main")).toBe(false);
  });

  it("hides a lane whose lens is shut — its placements are not what it was showing", () => {
    const l = [lane({ id: "cam", camera: "", cameraMonitor: "auto" })];
    expect(laneHidden(l, l[0], null)).toBe(true);
    expect(laneHidden(l, l[0], "cam")).toBe(false);
  });

  it("leaves an ordinary lane alone — no lens is not a shut lens", () => {
    const l = [lane({ id: "main" })];
    expect(laneHidden(l, l[0], null)).toBe(false);
  });
});
