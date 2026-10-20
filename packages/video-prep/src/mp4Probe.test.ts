// mp4Probe.test.ts — the box reader held to ffprobe's own answers on real encodes, where the machine has ffmpeg,
// and the fallback in probeVideo: an mp4 read without ffmpeg, anything else still a NoFfmpegError.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { probeMp4 } from "./mp4Probe";
import { NoFfmpegError, probeVideo } from "./probe";

const dir = mkdtempSync(join(tmpdir(), "mp4-probe-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Two seconds of test picture at 25 fps, encoded by `args` into `name`. */
function encode(name: string, args: string[], size = "320x240"): string {
  const out = join(dir, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${size}:rate=25:d=2`,
    ...args,
    out,
  ]);
  return out;
}

describe("probeMp4", () => {
  it("cannot say for what is not the ISO family", () => {
    const f = join(dir, "not.mkv");
    writeFileSync(f, Buffer.from("\x1aE\xdf\xa3 not an mp4 at all", "latin1"));
    expect(probeMp4(f)).toBeUndefined();
  });
});

describe.runIf(hasFfmpeg)("probeMp4 against ffprobe", () => {
  // What a phone records, what an editor exports, and what the plan has to refuse.
  const cases: [string, string[]][] = [
    ["h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
    ["h264-10.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p10le"]],
    ["h264-422.mov", ["-c:v", "libx264", "-pix_fmt", "yuv422p"]],
    ["hevc.mp4", ["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"]],
    ["hevc-10.mov", ["-c:v", "libx265", "-pix_fmt", "yuv420p10le"]],
    [
      "prores.mov",
      ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"],
    ],
    ["vp9.mp4", ["-c:v", "libvpx-vp9", "-b:v", "200k", "-pix_fmt", "yuv420p"]],
    ["av1.mp4", ["-c:v", "libsvtav1", "-pix_fmt", "yuv420p10le"]],
  ];

  it.each(cases)("%s reads as ffprobe reads it", async (name, args) => {
    const f = encode(name, args);
    const want = await probeVideo(f);
    const got = probeMp4(f);
    expect(want).not.toBeNull();
    expect(got).toMatchObject({
      codec: want?.codec,
      width: want?.width,
      height: want?.height,
      pixFmt: want?.pixFmt.replace("yuvj", "yuv"),
      container: want?.container,
    });
    expect(got?.fps).toBeCloseTo(want?.fps ?? 0, 2);
    expect(got?.seconds).toBeCloseTo(want?.seconds ?? 0, 1);
  });

  it("finds no picture in a sound file", () => {
    const f = join(dir, "sound.m4a");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=d=1",
      "-c:a",
      "aac",
      f,
    ]);
    expect(probeMp4(f)).toBeNull();
  });

  it("stands in for ffprobe where there is none, and says so", async () => {
    const mp4 = encode("phone.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]);
    const webm = encode("rec.webm", ["-c:v", "libvpx-vp9", "-b:v", "200k"]);
    vi.stubEnv("FFPROBE_BIN", join(dir, "no-ffprobe"));
    expect(await probeVideo(mp4)).toMatchObject({
      codec: "h264",
      noFfmpeg: true,
    });
    await expect(probeVideo(webm)).rejects.toBeInstanceOf(NoFfmpegError);
  });
});
