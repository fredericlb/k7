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

const H264_ANY = ["avc1.42001f", "avc1.4d0028", "avc1.640028"];
const AAC = ["mp4a.40.2"];

describe("what this build can actually encode", () => {
  it("says yes when H.264 and AAC are both there", async () => {
    const r = await probeExportSupport(1920, 1080, true, {
      video: encoder(H264_ANY),
      audio: encoder(AAC),
    });
    expect(r).toEqual({ ok: true });
  });

  it("accepts ANY of the H.264 profiles — a false negative would hide a working export", async () => {
    for (const only of H264_ANY) {
      const r = await probeExportSupport(1280, 720, false, {
        video: encoder([only]),
      });
      expect(r.ok, only).toBe(true);
    }
  });

  it("names H.264 when WebCodecs is present but cannot encode it", async () => {
    const r = await probeExportSupport(1920, 1080, true, {
      video: encoder(["vp09.00.10.08"]), // VP9 only, which mp4 will not take
      audio: encoder(AAC),
    });
    expect(r).toMatchObject({ ok: false, reason: "no-h264" });
    if (!r.ok) expect(r.detail).toContain("H.264");
  });

  it("names AAC when only the SOUND cannot be encoded", async () => {
    const r = await probeExportSupport(1920, 1080, true, {
      video: encoder(H264_ANY),
      audio: encoder(["opus"]),
    });
    expect(r).toMatchObject({ ok: false, reason: "no-aac" });
  });

  it("does not ask about AAC for a silent film", async () => {
    const r = await probeExportSupport(1920, 1080, false, {
      video: encoder(H264_ANY),
      audio: encoder([]),
    });
    expect(r).toEqual({ ok: true });
  });

  it("says no WebCodecs when there is no VideoEncoder at all", async () => {
    const r = await probeExportSupport(1920, 1080, true, {});
    expect(r).toMatchObject({ ok: false, reason: "no-webcodecs" });
  });

  it("treats a config the encoder refuses to parse as a no, not a crash", async () => {
    const r = await probeExportSupport(1920, 1080, false, {
      video: {
        isConfigSupported: () => Promise.reject(new Error("bad config")),
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "no-h264" });
  });

  it("asks at the SIZE the scene will use — H.264 support is level-dependent", async () => {
    const seen: unknown[] = [];
    await probeExportSupport(3840, 2160, false, {
      video: {
        isConfigSupported: (c) => {
          seen.push(c);
          return Promise.resolve({ supported: true });
        },
      },
    });
    expect(seen[0]).toMatchObject({ width: 3840, height: 2160 });
  });
});
