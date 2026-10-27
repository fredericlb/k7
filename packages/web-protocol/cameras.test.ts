import { describe, expect, it } from "vitest";
import {
  cleanCameraName,
  isRemoteLabel,
  matchRemoteCamera,
  readCameraFrame,
  remoteLabel,
  remoteName,
  uniqueCameraName,
} from "./cameras.ts";

const cams = [
  { name: "Pixel 8 · Chrome", since: 10 },
  { name: "iPad", since: 30 },
  { name: "Stage left", since: 20 },
];

describe("remote labels", () => {
  it("round-trips a device name", () => {
    const l = remoteLabel("iPad");
    expect(isRemoteLabel(l)).toBe(true);
    expect(remoteName(l)).toBe("iPad");
    expect(isRemoteLabel("Logitech BRIO")).toBe(false);
  });
});

describe("matchRemoteCamera", () => {
  it("says so when none is on", () => {
    expect(matchRemoteCamera("remote:iPad", [])).toEqual({
      name: null,
      problem: "no remote camera is on",
    });
  });
  it("takes the newest for a bare prefix", () => {
    expect(matchRemoteCamera("remote:", cams)).toEqual({ name: "iPad" });
  });
  it("matches exactly, then ignoring case, then by containment", () => {
    expect(matchRemoteCamera("remote:Stage left", cams).name).toBe(
      "Stage left",
    );
    expect(matchRemoteCamera("remote:stage LEFT", cams).name).toBe(
      "Stage left",
    );
    expect(matchRemoteCamera("remote:pixel", cams).name).toBe(
      "Pixel 8 · Chrome",
    );
  });
  it("falls back to the newest and names the ones that are on", () => {
    const m = matchRemoteCamera("remote:Drums", cams);
    expect(m.name).toBe("iPad");
    expect(m.problem).toContain('"Drums"');
    expect(m.problem).toContain("Stage left");
  });
});

describe("names", () => {
  it("cleans to one capped line", () => {
    expect(cleanCameraName("  a\nb\t c ")).toBe("a b c");
    expect(cleanCameraName("   ")).toBe("camera");
    expect(cleanCameraName("x".repeat(100))).toHaveLength(60);
  });
  it("suffixes a name already taken, case-insensitively", () => {
    expect(uniqueCameraName("iPad", [])).toBe("iPad");
    expect(uniqueCameraName("iPad", ["ipad"])).toBe("iPad (2)");
    expect(uniqueCameraName("iPad", ["iPad", "iPad (2)"])).toBe("iPad (3)");
  });
});

describe("readCameraFrame", () => {
  it("reads a frame and refuses anything else", () => {
    expect(readCameraFrame('{"type":"gone","from":"v1"}')).toEqual({
      type: "gone",
      from: "v1",
    });
    expect(readCameraFrame("nope")).toBeNull();
    expect(readCameraFrame("42")).toBeNull();
  });
});
