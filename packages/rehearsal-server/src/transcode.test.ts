import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLimiter, cutClip, joinTakes } from "./transcode.ts";

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createLimiter", () => {
  it("runs N tasks with at most K in flight, all of them to the end", async () => {
    const limiter = createLimiter(2);
    let inFlight = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        limiter.run(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await later(10);
          inFlight--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(limiter.active).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  it("frees a slot when a task fails", async () => {
    const limiter = createLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    expect(await limiter.run(async () => "next")).toBe("next");
  });
});

/** A 16-bit wav of a 330 Hz tone at `level`. */
function wav(
  dir: string,
  name: string,
  rate: number,
  channels: number,
  seconds: number,
  level = 0.1,
) {
  const frames = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + frames * channels * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(frames * channels * 2, 40);
  for (let f = 0; f < frames; f++) {
    const v = Math.round(
      level * 32767 * Math.sin((2 * Math.PI * 330 * f) / rate),
    );
    for (let c = 0; c < channels; c++)
      b.writeInt16LE(v, 44 + (f * channels + c) * 2);
  }
  const p = path.join(dir, name);
  fs.writeFileSync(p, b);
  return p;
}

/** Seconds of audio `file` holds, as the WebAssembly decoder counts them. */
async function seconds(file: string): Promise<number> {
  const { decodeFrames } = await import("@studio/audio-analysis/decode");
  const facts = await decodeFrames(file, () => {});
  return facts.frames / facts.sampleRate;
}

describe("a moment's cut and a splice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-transcode-"));

  it("cuts the span asked, as a WebM/Opus file", async () => {
    const src = wav(dir, "take.wav", 44_100, 2, 6);
    const out = path.join(dir, "clip.webm");
    await cutClip(src, 1.5, 2, out, {
      timeoutMs: 60_000,
      limiter: createLimiter(1),
    });
    expect(fs.readFileSync(out).subarray(0, 4)).toEqual(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    );
    expect(await seconds(out)).toBeCloseTo(2, 3);
  });

  it("joins takes of different rates and channel counts end to end", async () => {
    const a = wav(dir, "a.wav", 48_000, 2, 2);
    const b = wav(dir, "b.wav", 22_050, 1, 3);
    const out = path.join(dir, "joined.webm");
    await joinTakes([a, b], out, {
      timeoutMs: 60_000,
      limiter: createLimiter(1),
    });
    expect(await seconds(out)).toBeCloseTo(5, 3);
  });

  it("refuses a file that is not audio, leaving nothing behind", async () => {
    const junk = path.join(dir, "junk.webm");
    fs.writeFileSync(junk, Buffer.alloc(4096, 0x41));
    const out = path.join(dir, "never.webm");
    await expect(
      cutClip(junk, 0, 1, out, {
        timeoutMs: 60_000,
        limiter: createLimiter(1),
      }),
    ).rejects.toThrow(/cannot open/);
    expect(fs.readdirSync(dir).filter((f) => f.includes("never.webm"))).toEqual(
      [],
    );
  });
});
