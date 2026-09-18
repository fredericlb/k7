// The instrumental mix, run for real on three generated tones: ffmpeg is the part that can go wrong.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { INSTRUMENTAL_STEMS, mixArgs, mixStems } from "./instrumentalMix.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k7-mix-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const tone = (name: string, frequency: number) => {
  const file = path.join(dir, `${name}.wav`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:duration=1`,
    "-ac",
    "2",
    file,
  ]);
  return file;
};

describe("mixArgs", () => {
  it("sums every input without normalising, into FLAC", () => {
    const args = mixArgs(["a.wav", "b.wav", "c.wav"], "out.flac");
    expect(args).toContain("amix=inputs=3:normalize=0");
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
    expect(args.slice(-3)).toEqual(["-c:a", "flac", "out.flac"]);
  });

  it("leaves the voice out", () => {
    expect(INSTRUMENTAL_STEMS).toEqual(["drums", "bass", "other"]);
  });
});

describe("mixStems", () => {
  it("writes one stereo FLAC as long as the stems", async () => {
    const inputs = [tone("drums", 110), tone("bass", 55), tone("other", 440)];
    const out = path.join(dir, "instrumental.flac");
    await mixStems(inputs, out);
    const probe = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,channels:format=duration",
      "-of",
      "json",
      out,
    ]).toString();
    const info = JSON.parse(probe);
    expect(info.streams[0].codec_name).toBe("flac");
    expect(info.streams[0].channels).toBe(2);
    expect(Number(info.format.duration)).toBeCloseTo(1, 1);
  });

  it("rejects with ffmpeg's own words when an input is missing", async () => {
    await expect(
      mixStems([path.join(dir, "nope.wav")], path.join(dir, "x.flac")),
    ).rejects.toThrow(/ffmpeg exited/);
  });
});
