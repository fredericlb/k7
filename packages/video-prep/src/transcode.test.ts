// The copies themselves: the arguments that decide what a browser can play, and one real round
// trip through ffmpeg where the machine has it — a ProRes .mov in, a playable H.264 mp4 out.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planVideo } from "./plan";
import { probeVideo } from "./probe";
import { copyArgs, copyPathOf, makeCopy } from "./transcode";

const dir = mkdtempSync(join(tmpdir(), "video-prep-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("copyArgs", () => {
  it("drops the sound from every copy — the engine plays a shot's sound", () => {
    for (const k of ["remux", "transcode", "proxy"] as const)
      expect(copyArgs(k, "a.mov", "a.mp4")).toContain("-an");
  });

  it("re-encodes to 8-bit 4:2:0 H.264, the one stream every browser decodes", () => {
    const a = copyArgs("transcode", "a.mov", "a.mp4");
    expect(a.slice(a.indexOf("-c:v"), a.indexOf("-c:v") + 4)).toEqual([
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ]);
  });

  it("copies the stream untouched for a remux", () => {
    const a = copyArgs("remux", "a.mkv", "a.mp4");
    expect(a[a.indexOf("-c:v") + 1]).toBe("copy");
  });

  it("names copies beside their source", () => {
    expect(copyPathOf("clips/a.MOV", "optimized")).toBe(
      "clips/a.optimized.mp4",
    );
    expect(copyPathOf("clips/a.mp4", "proxy")).toBe("clips/a.proxy.mp4");
  });
});

describe.skipIf(!hasFfmpeg)("a real round trip", () => {
  it("turns a ProRes .mov into a playable mp4, and leaves no .part behind", async () => {
    const src = join(dir, "pro.mov");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=s=320x240:d=0.5",
      "-c:v",
      "prores_ks",
      src,
    ]);
    const facts = await probeVideo(src);
    expect(facts?.codec).toBe("prores");
    const plan = planVideo(facts as NonNullable<typeof facts>);
    expect(plan.optimized).toBe("transcode");
    const dest = join(dir, "pro.optimized.mp4");
    await makeCopy("transcode", src, dest);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(await probeVideo(dest)).toMatchObject({
      codec: "h264",
      pixFmt: "yuv420p",
      width: 320,
      height: 240,
    });
  });

  it("answers null for a file with no picture", async () => {
    const wav = join(dir, "tone.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=d=0.2",
      wav,
    ]);
    expect(await probeVideo(wav)).toBeNull();
  });
});
