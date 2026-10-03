// waveformNoEngine.test.ts — the hosted service has no engine binary: a clip with no sidecar must
// still get one, through ffmpeg, rather than a "binary not found". Skipped where ffmpeg is missing.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachePath } from "@studio/audio-analysis/sidecar";
import { describe, expect, it } from "vitest";
import { ensureFileEnvelope } from "./waveformCache.ts";

const hasFfmpeg = (() => {
  try {
    execFileSync(process.env.FFMPEG_BIN || "ffmpeg", ["-version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("a waveform with no engine binary", () => {
  it("is analysed through ffmpeg, and its sidecar written beside the clip", async () => {
    const wav = join(mkdtempSync(join(tmpdir(), "wf-noengine-")), "tone.wav");
    execFileSync(
      process.env.FFMPEG_BIN || "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        wav,
      ],
      { stdio: "ignore" },
    );
    const env = await ensureFileEnvelope(wav, null);
    expect(env.peak.length).toBeGreaterThan(0);
    expect(existsSync(cachePath(wav))).toBe(true);
  });
});
