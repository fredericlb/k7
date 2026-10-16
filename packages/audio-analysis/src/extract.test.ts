// extract.test.ts — a video's sound written out as a float WAV: through a stand-in engine when
// there is no ffmpeg, and through the real ffmpeg where a machine has one (skipped elsewhere).

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "extract-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

// The fmt and data facts a WAV header states, read back the way a reader would.
function readWav(file: string) {
  const b = readFileSync(file);
  return {
    riff: b.toString("ascii", 0, 4),
    format: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    sampleRate: b.readUInt32LE(24),
    bits: b.readUInt16LE(34),
    dataBytes: b.readUInt32LE(40),
    fileBytes: b.length,
    first: b.readFloatLE(44),
  };
}

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(process.platform === "win32")("with no ffmpeg", () => {
  it("falls back to the engine's --decode and writes what it streamed", async () => {
    vi.stubEnv("FFMPEG_BIN", join(dir, "no-such-ffmpeg"));
    vi.stubEnv("FFPROBE_BIN", join(dir, "no-such-ffprobe"));
    vi.resetModules();
    const { extractSound } = await import("./extract.ts");
    const samples = new Float32Array([0.25, -0.25, 0.5, -0.5, 1, -1]);
    const bin = join(dir, "engine");
    writeFileSync(
      bin,
      `#!/usr/bin/env node
process.stdout.write('{"sampleRate":48000,"channels":2,"frames":3}\\n');
process.stdout.write(Buffer.from("${Buffer.from(samples.buffer).toString("base64")}", "base64"));
`,
    );
    chmodSync(bin, 0o755);
    const dest = join(dir, "fallback.wav");
    const facts = await extractSound(join(dir, "any.mp4"), dest, {
      engineBin: bin,
    });
    expect(facts).toEqual({ sampleRate: 48000, channels: 2, frames: 3 });
    expect(readWav(dest)).toEqual({
      riff: "RIFF",
      format: 3,
      channels: 2,
      sampleRate: 48000,
      bits: 32,
      dataBytes: 24,
      fileBytes: 44 + 24,
      first: 0.25,
    });
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)("with ffmpeg", () => {
  const make = (name: string, audio: boolean) => {
    const file = join(dir, name);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.5",
      ...(audio
        ? [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100:duration=0.5",
          ]
        : []),
      "-shortest",
      file,
    ]);
    return file;
  };

  it("writes a video's sound at its own rate", async () => {
    vi.resetModules();
    const { extractSound } = await import("./extract.ts");
    const dest = join(dir, "real.wav");
    const facts = await extractSound(make("with.mp4", true), dest);
    expect(facts?.sampleRate).toBe(44100);
    const wav = readWav(dest);
    expect(wav).toMatchObject({ riff: "RIFF", format: 3, sampleRate: 44100 });
    expect(wav.dataBytes).toBe(wav.fileBytes - 44);
    expect(wav.dataBytes).toBe(
      (facts?.frames ?? 0) * (facts?.channels ?? 0) * 4,
    );
  });

  it("answers null for a film with no sound, and writes nothing", async () => {
    vi.resetModules();
    const { extractSound } = await import("./extract.ts");
    const dest = join(dir, "silent.wav");
    expect(await extractSound(make("without.mp4", false), dest)).toBeNull();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});
