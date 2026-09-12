// `"VideoEncoder" in window` answers the wrong question, and answers it TRUE in every Electron
// build. So the cases that matter are the ones where the class is there and the encoder is not:
// the export then fails at frame 0, after the progress bar has drawn, naming no cause.

import { describe, expect, it } from "vitest";
import { probeExportSupport } from "./exportSupport";

type Cfg = { codec?: string };
/** An encoder that says yes to the codecs in `ok` and no to everything else. */
const encoder = (ok: string[]) => ({
  isConfigSupported: (c: unknown) =>
    Promise.resolve({ supported: ok.includes((c as Cfg).codec ?? "") }),
});

const VP9 = ["vp09.00.10.08"];
const VP8 = ["vp8"];
const OPUS = ["opus"];
const H264_ANY = ["avc1.42001f", "avc1.4d0028", "avc1.640028"];
const AAC = ["mp4a.40.2"];

describe("what this build can actually encode", () => {
  it("blesses VP9 and Opus for a webm, and NAMES them for the encoder", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, true, {
      video: encoder(VP9),
      audio: encoder(OPUS),
    });
    expect(r).toEqual({ ok: true, video: "vp9", audio: "opus" });
  });

  it("falls back to VP8 when VP9 is refused — the answer says which one to use", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, false, {
      video: encoder(VP8),
    });
    expect(r).toEqual({ ok: true, video: "vp8" });
  });

  it("blesses H.264 and AAC for an mp4", async () => {
    const r = await probeExportSupport("mp4", 1920, 1080, true, {
      video: encoder(H264_ANY),
      audio: encoder(AAC),
    });
    expect(r).toEqual({ ok: true, video: "avc", audio: "aac" });
  });

  it("accepts ANY of the H.264 profiles — a false negative would hide a working export", async () => {
    for (const only of H264_ANY) {
      const r = await probeExportSupport("mp4", 1280, 720, false, {
        video: encoder([only]),
      });
      expect(r, only).toEqual({ ok: true, video: "avc" });
    }
  });

  it("names the codec when WebCodecs is present but cannot encode it", async () => {
    const r = await probeExportSupport("mp4", 1920, 1080, true, {
      video: encoder(VP9), // VP9 only, which mp4 will not take
      audio: encoder(AAC),
    });
    expect(r).toMatchObject({ ok: false, reason: "no-video-codec" });
    if (!r.ok) expect(r.detail).toContain("H.264");
  });

  // The case Firefox lands on for an mp4: it encodes H.264 and has never encoded AAC.
  it("names the sound codec when only the SOUND cannot be encoded", async () => {
    const r = await probeExportSupport("mp4", 1920, 1080, true, {
      video: encoder(H264_ANY),
      audio: encoder(OPUS),
    });
    expect(r).toMatchObject({ ok: false, reason: "no-audio-codec" });
    if (!r.ok) expect(r.detail).toContain("AAC");
  });

  it("does not ask about the sound codec for a silent film", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, false, {
      video: encoder(VP9),
      audio: encoder([]),
    });
    expect(r).toEqual({ ok: true, video: "vp9" });
  });

  it("refuses the sound when there is no AudioEncoder at all", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, true, {
      video: encoder(VP9),
    });
    expect(r).toMatchObject({ ok: false, reason: "no-audio-codec" });
  });

  it("says no WebCodecs when there is no VideoEncoder at all", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, true, {});
    expect(r).toMatchObject({ ok: false, reason: "no-webcodecs" });
  });

  it("treats a config the encoder refuses to parse as a no, not a crash", async () => {
    const r = await probeExportSupport("webm", 1920, 1080, false, {
      video: {
        isConfigSupported: () => Promise.reject(new Error("bad config")),
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "no-video-codec" });
  });

  it("asks at the SIZE the scene will use — codec support is level-dependent", async () => {
    const seen: unknown[] = [];
    await probeExportSupport("webm", 3840, 2160, false, {
      video: {
        isConfigSupported: (c: unknown) => {
          seen.push(c);
          return Promise.resolve({ supported: true });
        },
      },
    });
    expect(seen[0]).toMatchObject({ width: 3840, height: 2160 });
  });
});
