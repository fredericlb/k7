// decodeWasm.test.ts — the WebAssembly decoder: what it hands over, the fallback to it when ffmpeg is missing, and,
// where ffmpeg is installed, that it decodes compressed files to the same frames at the same positions.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { decodeFrames, NoFfmpegError, TooLongError } from "./decode.ts";
import { decodeWithWasm } from "./decodeWasm.ts";

const dir = mkdtempSync(join(tmpdir(), "decode-wasm-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const RATE = 44_100;

/** A 16-bit stereo wav: a decaying 60 Hz kick every half second on both sides, a tone on the left. */
function wav(name: string, seconds: number): string {
  const frames = Math.round(seconds * RATE);
  const b = Buffer.alloc(44 + frames * 4);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + frames * 4, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(frames * 4, 40);
  for (let f = 0; f < frames; f++) {
    const t = f / RATE;
    const kick =
      0.6 * Math.exp(-30 * (t % 0.5)) * Math.sin(2 * Math.PI * 60 * t);
    const tone = 0.2 * Math.sin(2 * Math.PI * 220 * t);
    b.writeInt16LE(Math.round((kick + tone) * 32767), 44 + f * 4);
    b.writeInt16LE(Math.round(kick * 32767), 46 + f * 4);
  }
  const path = join(dir, name);
  writeFileSync(path, b);
  return path;
}

/** Every frame `decode` hands over, joined. */
async function frames(
  decode: (
    cb: (s: Float32Array, c: number, n: number) => void,
  ) => Promise<unknown>,
): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  await decode((s, c, n) => parts.push(s.slice(0, n * c)));
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

/** ffmpeg and ffprobe pointed at nothing, as on the phone. */
function noFfmpeg(): void {
  vi.stubEnv("FFMPEG_BIN", join(dir, "no-ffmpeg"));
  vi.stubEnv("FFPROBE_BIN", join(dir, "no-ffprobe"));
}

describe("decodeWithWasm", () => {
  const src = wav("kick.wav", 3);

  it("hands over every frame of a wav at its own rate, every channel", async () => {
    let facts: unknown;
    const got = await frames(async (cb) => {
      facts = await decodeWithWasm(src, cb);
    });
    expect(facts).toEqual({ sampleRate: RATE, channels: 2, frames: 3 * RATE });
    expect(got.length).toBe(3 * RATE * 2);
    expect(got[2 * 1000 + 1]).toBeCloseTo(
      0.6 *
        Math.exp(-30 * (1000 / RATE)) *
        Math.sin((2 * Math.PI * 60 * 1000) / RATE),
      4,
    );
  });

  it("refuses what is not audio, saying so", async () => {
    const junk = join(dir, "junk.mp3");
    writeFileSync(junk, Buffer.alloc(4096, 0x41));
    await expect(decodeWithWasm(junk, () => {})).rejects.toThrow(/cannot open/);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    let blocks = 0;
    const p = decodeWithWasm(
      src,
      () => {
        blocks++;
        ac.abort();
      },
      ac.signal,
    );
    await expect(p).rejects.toThrow(/aborted/);
    expect(blocks).toBe(1);
  });
});

describe("decodeFrames without ffmpeg", () => {
  const src = wav("fallback.wav", 2);

  it("decodes with WebAssembly", async () => {
    noFfmpeg();
    const got = await frames((cb) => decodeFrames(src, cb));
    expect(got.length).toBe(2 * RATE * 2);
  });

  it("still says ffmpeg is missing when told not to fall back", async () => {
    noFfmpeg();
    await expect(
      decodeFrames(src, () => {}, { wasm: false }),
    ).rejects.toBeInstanceOf(NoFfmpegError);
  });

  it("holds the frame cap", async () => {
    noFfmpeg();
    await expect(
      decodeFrames(src, () => {}, { maxFrames: RATE }),
    ).rejects.toBeInstanceOf(TooLongError);
  });
});

const ffmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(ffmpeg)("against ffmpeg", () => {
  const src = wav("source.wav", 10);
  // mp3 and AAC both carry an encoder delay ffmpeg trims: a decoder that does not is off by it.
  const encodings: [string, string[]][] = [
    ["flac", []],
    ["mp3", ["-c:a", "libmp3lame", "-b:a", "192k"]],
    ["m4a", ["-c:a", "aac", "-b:a", "192k"]],
  ];

  it.each(encodings)(
    "%s decodes to the same frames, at the same positions",
    async (ext, args) => {
      const file = join(dir, `encoded.${ext}`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, ...args, file]);
      const want = await frames((cb) =>
        decodeFrames(file, cb, { wasm: false }),
      );
      const got = await frames((cb) => decodeWithWasm(file, cb));
      expect(got.length).toBe(want.length);
      let worst = 0;
      for (let i = 0; i < want.length; i++)
        worst = Math.max(worst, Math.abs(got[i] - want[i]));
      expect(worst).toBeLessThan(1e-4);
    },
  );
});
