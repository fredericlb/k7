// A take's naming and its placement. The container decides the EXTENSION, and the extension is the
// only thing that tells the compiler a clip is picture rather than sound — get it wrong and the
// take files perfectly and then compiles as audio.

import { describe, expect, it } from "vitest";
import {
  extForMime,
  fileStamp,
  pickVideoMime,
  placeLine,
  takeId,
  VIDEO_MIMES,
} from "./videoTake";

describe("pickVideoMime", () => {
  it("takes the best the browser admits to", () => {
    expect(pickVideoMime((m) => m === "video/webm")).toBe("video/webm");
    expect(pickVideoMime(() => true)).toBe(VIDEO_MIMES[0]);
  });

  it("answers undefined when it admits to none, which asks the recorder to choose", () => {
    expect(pickVideoMime(() => false)).toBeUndefined();
  });
});

describe("extForMime", () => {
  it("gives every webm spelling the same extension", () => {
    expect(extForMime("video/webm;codecs=vp9")).toBe(".webm");
    expect(extForMime("video/webm")).toBe(".webm");
  });

  it("keeps mp4 apart, and falls back to webm when nothing was chosen", () => {
    expect(extForMime("video/mp4")).toBe(".mp4");
    expect(extForMime(undefined)).toBe(".webm");
  });
});

describe("takeId", () => {
  it("names the lane and the moment", () => {
    expect(takeId("main", "260814T194357")).toBe("main_260814T194357");
  });

  it("folds what a path would argue about, and never answers a bare stamp", () => {
    expect(takeId("A roll/2", "S")).toBe("A-roll-2_S");
    expect(takeId("...", "S")).toBe("lane_S");
  });

  it("stamps two digits everywhere, so the names sort", () => {
    expect(fileStamp(new Date(2026, 7, 9, 4, 5, 6))).toBe("260809T040506");
  });
});

describe("placeLine", () => {
  it("carries the MEASURED length, since a fresh WebM states none", () => {
    expect(placeLine("main", "main_S", 12.3456, 4.5)).toBe(
      "picture add main main_S 12.346 4.5",
    );
  });

  it("never sends a negative — a take cannot start before the song does", () => {
    expect(placeLine("main", "x", -1, -2)).toBe("picture add main x 0 0");
  });
});
