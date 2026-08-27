import { afterEach, describe, expect, it } from "vitest";
import {
  enginePathMap,
  mapFrame,
  toWindowsPath,
  toWslPath,
} from "./enginePaths";

afterEach(() => {
  process.env.STUDIO_ENGINE_PATH_STYLE = undefined;
});

describe("enginePaths", () => {
  it("maps a drive mount both ways", () => {
    expect(toWindowsPath("/mnt/c/Users/flb/.studio/root/song.wav")).toBe(
      "C:\\Users\\flb\\.studio\\root\\song.wav",
    );
    expect(toWslPath("C:\\Users\\flb\\.studio\\root\\song.wav")).toBe(
      "/mnt/c/Users/flb/.studio/root/song.wav",
    );
  });

  it("round-trips, which is what snapshotPluginBase compares on", () => {
    const p = "/mnt/d/Presets/warm.vstpreset";
    expect(toWslPath(toWindowsPath(p))).toBe(p);
  });

  it("leaves anything that is not a path alone", () => {
    for (const s of ["", "project", "/home/flb/x", "/mnt/cd/x", "1:2"])
      expect(toWslPath(toWindowsPath(s))).toBe(s);
  });

  it("is off unless asked for", () => {
    expect(enginePathMap()).toBeNull();
    process.env.STUDIO_ENGINE_PATH_STYLE = "windows";
    expect(enginePathMap()).not.toBeNull();
  });

  it("walks a frame without touching its numbers", () => {
    const frame = {
      type: "take",
      path: "/mnt/c/a b/t.wav",
      seconds: 12.5,
      ok: true,
      clips: [{ source: "/mnt/c/x.wav" }],
    };
    expect(mapFrame(frame, toWindowsPath)).toEqual({
      type: "take",
      path: "C:\\a b\\t.wav",
      seconds: 12.5,
      ok: true,
      clips: [{ source: "C:\\x.wav" }],
    });
  });
});
