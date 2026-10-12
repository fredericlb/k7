// decode.test.ts — the mono sum, and the engine's `--decode` stream read back through a stand-in
// engine: a header line, then frames whose chunk boundaries fall anywhere. ffmpeg itself is not
// exercised here: it is absent from a dev machine and present in the image.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeFrames, decodeMono, monoFromInterleaved } from "./decode.ts";
import { measureFilePeak, PEAK_FLOOR_DB, toDb } from "./peak.ts";

/** Interleaved f32 from per-channel sample lists. */
function interleave(channels: number[][]): Float32Array {
  const frames = channels[0].length;
  const out = new Float32Array(frames * channels.length);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels.length; c++)
      out[f * channels.length + c] = channels[c][f];
  return out;
}

describe("monoFromInterleaved", () => {
  it("averages a stereo pair", () => {
    const s = interleave([
      [1, 0, -1],
      [0, 1, -1],
    ]);
    expect([...monoFromInterleaved(s, 2, 3)]).toEqual([0.5, 0.5, -1]);
  });

  it("passes mono through untouched", () => {
    expect([...monoFromInterleaved(interleave([[0.25, -0.5]]), 1, 2)]).toEqual([
      0.25, -0.5,
    ]);
  });

  // JUCE's sum takes the FIRST two channels rather than downmixing, so a centre channel is not weighted in.
  it("ignores every channel past the second", () => {
    const s = interleave([
      [1, 1],
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    expect([...monoFromInterleaved(s, 4, 2)]).toEqual([0.5, 0.5]);
  });
});

describe("toDb", () => {
  it("floors silence instead of answering -Infinity", () => {
    expect(toDb(0)).toBe(PEAK_FLOOR_DB);
  });

  it("reads full scale as 0 dBFS", () => {
    expect(toDb(1)).toBeCloseTo(0, 9);
  });
});

// A stand-in for `st0-engine --decode`: writes the stream in deliberately awkward pieces.
describe.skipIf(process.platform === "win32")("the --decode stream", () => {
  const dir = mkdtempSync(join(tmpdir(), "decode-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** An executable that prints `header` then `samples`, split at every `cuts` byte offset. */
  function fakeEngine(
    header: string,
    samples: Float32Array,
    cuts: number[],
  ): string {
    const bin = join(dir, `engine-${Math.random().toString(36).slice(2)}`);
    const bytes = Buffer.concat([
      Buffer.from(`${header}\n`),
      Buffer.from(samples.buffer),
    ]);
    const pieces: string[] = [];
    let at = 0;
    for (const cut of [...cuts, bytes.length]) {
      pieces.push(bytes.subarray(at, cut).toString("base64"));
      at = cut;
    }
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const pieces = ${JSON.stringify(pieces)};
(async () => {
  for (const p of pieces) {
    process.stdout.write(Buffer.from(p, "base64"));
    await new Promise((r) => setTimeout(r, 5));
  }
})();
`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  it("reads the header and every frame, whatever the chunking", async () => {
    const samples = interleave([
      [0.5, -0.25, 1, 0],
      [0.5, 0.25, 0, -1],
    ]);
    // Inside the header, then mid-float, then mid-frame.
    const engineBin = fakeEngine(
      '{"sampleRate":44100,"channels":2,"frames":4}',
      samples,
      [10, 50, 58],
    );
    const got = await decodeMono("ignored.wav", { engineBin });
    expect(got.sampleRate).toBe(44100);
    expect(got.channels).toBe(2);
    expect(got.frames).toBe(4);
    expect(got.mono.flatMap((b) => [...b])).toEqual([0.5, 0, 0.5, -0.5]);
  });

  // The whole reason for a separate measurement: the mono sum of an anti-phase pair is silence.
  it("measures the true peak across channels, where the mono sum reads silence", async () => {
    const samples = interleave([
      [0.8, -0.8],
      [-0.8, 0.8],
    ]);
    const engineBin = fakeEngine(
      '{"sampleRate":48000,"channels":2,"frames":2}',
      samples,
      [],
    );
    const peak = await measureFilePeak("ignored.wav", { engineBin });
    expect(peak.peak).toBeCloseTo(0.8, 6);
    expect(peak.peakDb).toBeCloseTo(20 * Math.log10(0.8), 4);
    const mono = await decodeMono("ignored.wav", { engineBin });
    expect(mono.mono.flatMap((b) => [...b])).toEqual([0, 0]);
  });

  it("refuses a stream with no header", async () => {
    const engineBin = fakeEngine("not json", new Float32Array(0), []);
    await expect(
      decodeFrames("ignored.wav", () => {}, { engineBin }),
    ).rejects.toThrow();
  });
});
