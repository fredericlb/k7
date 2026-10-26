// The plan for a video: what would go wrong silently is a 10-bit H.264 passed as playable (it
// fails in every browser), a .mov sent to a full re-encode when a stream copy would do, and a
// 4K source previewed as it is.

import { describe, expect, it } from "vitest";
import { ANDROID_PLAYABLE_CODECS, planVideo } from "./plan";
import type { VideoFacts } from "./probe";

const mp4 = "mov,mp4,m4a,3gp,3g2,mj2";
const facts = (over: Partial<VideoFacts> = {}): VideoFacts => ({
  codec: "h264",
  width: 1920,
  height: 1080,
  pixFmt: "yuv420p",
  fps: 30,
  seconds: 10,
  container: mp4,
  ...over,
});

describe("planVideo", () => {
  it("leaves a playable 1080p mp4 alone", () => {
    expect(planVideo(facts())).toMatchObject({
      optimized: "none",
      proxy: false,
    });
  });

  it("optimizes a codec no browser decodes, at full resolution", () => {
    for (const codec of ["hevc", "prores", "dnxhd", "mpeg2video"])
      expect(planVideo(facts({ codec })).optimized).toBe("transcode");
  });

  it("optimizes a playable codec in a pixel format browsers refuse", () => {
    expect(planVideo(facts({ pixFmt: "yuv420p10le" })).optimized).toBe(
      "transcode",
    );
    expect(planVideo(facts({ pixFmt: "yuv422p" })).optimized).toBe("transcode");
  });

  it("only REMUXES a playable stream in the wrong container", () => {
    expect(planVideo(facts({ container: "matroska,webm" })).optimized).toBe(
      "none",
    );
    // ffprobe names a .mov "mov,mp4,…" too; a .mkv with H.264 is the case a copy fixes.
    expect(planVideo(facts({ container: "matroska" })).optimized).toBe("remux");
  });

  it("re-encodes a rotated stream upright, even a playable one", () => {
    for (const rotation of [90, 180, 270])
      expect(planVideo(facts({ rotation })).optimized).toBe("transcode");
    expect(planVideo(facts({ rotation: 0 })).optimized).toBe("none");
  });

  it("adds a proxy above 1080p, whatever else it needs", () => {
    expect(planVideo(facts({ width: 3840, height: 2160 }))).toMatchObject({
      optimized: "none",
      proxy: true,
    });
    expect(planVideo(facts({ codec: "hevc", height: 2160 }))).toMatchObject({
      optimized: "transcode",
      proxy: true,
    });
  });
});

describe("planVideo on the phone", () => {
  const hevc = facts({ codec: "hevc" });

  it("plays a phone's HEVC as it is, where elsewhere it is transcoded", () => {
    expect(planVideo(hevc, ANDROID_PLAYABLE_CODECS).optimized).toBe("none");
    expect(planVideo(hevc).optimized).toBe("transcode");
  });

  it("still refuses its 10-bit HDR", () => {
    expect(
      planVideo({ ...hevc, pixFmt: "yuv420p10le" }, ANDROID_PLAYABLE_CODECS)
        .optimized,
    ).toBe("transcode");
  });
});
