// envelope.test.ts — the port's own arithmetic, checked without ffmpeg: a synthetic click track
// has a tempo we chose, and the bucket geometry is fixed by the frame count alone.

import { describe, expect, it } from "vitest";
import type { DecodedAudio } from "./decode.ts";
import { buildEnvelope, detectBpm } from "./envelope.ts";

const RATE = 48000;

/** Clicks at `bpm`, one chunk, so the caller can hand it straight to `buildEnvelope`. */
function clickTrack(bpm: number, seconds: number): DecodedAudio {
  const frames = RATE * seconds;
  const mono = new Float32Array(frames);
  const period = Math.round((60 / bpm) * RATE);
  for (let at = 0; at < frames; at += period)
    // A short decaying click, so the onset envelope has a rise to correlate.
    for (let k = 0; k < 200 && at + k < frames; k++)
      mono[at + k] = (1 - k / 200) ** 2;
  return { sampleRate: RATE, channels: 1, frames, mono: [mono] };
}

describe("buildEnvelope", () => {
  it("finds the tempo of a click track", () => {
    for (const bpm of [90, 120, 140]) {
      const env = buildEnvelope(clickTrack(bpm, 16), "fp");
      expect(env.bpm).toBeGreaterThan(bpm - 1);
      expect(env.bpm).toBeLessThan(bpm + 1);
    }
  });

  it("reports 0 rather than guessing at silence", () => {
    const frames = RATE * 8;
    const env = buildEnvelope(
      {
        sampleRate: RATE,
        channels: 1,
        frames,
        mono: [new Float32Array(frames)],
      },
      "fp",
    );
    expect(env.bpm).toBe(0);
    expect(env.transients).toEqual([]);
  });

  // The cap is what keeps a long file's sidecar from growing without bound.
  it("caps the bucket count at 8192, and keeps every array in that one space", () => {
    const env = buildEnvelope(clickTrack(120, 120), "fp");
    expect(env.peak.length).toBe(8192);
    for (const a of [env.rms, env.low, env.mid, env.high])
      expect(a?.length).toBe(env.peak.length);
  });

  it("keeps near-full detail for a short one-shot", () => {
    const frames = 1024;
    const env = buildEnvelope(
      {
        sampleRate: RATE,
        channels: 1,
        frames,
        mono: [new Float32Array(frames)],
      },
      "fp",
    );
    expect(env.peak.length).toBe(4); // ceil(1024 / 256)
  });

  // Chunking is a decode artefact: the band followers carry state, so it must not show.
  it("gives the same envelope whatever the chunk boundaries", () => {
    const whole = clickTrack(120, 4);
    const cut = whole.mono[0];
    const pieces: Float32Array[] = [];
    for (let i = 0; i < cut.length; i += 7000)
      pieces.push(cut.subarray(i, i + 7000));
    const a = buildEnvelope(whole, "fp");
    const b = buildEnvelope({ ...whole, mono: pieces }, "fp");
    expect(b.peak).toEqual(a.peak);
    expect(b.low).toEqual(a.low);
    expect(b.bpm).toBe(a.bpm);
  });

  it("reports the stream's own facts back", () => {
    const env = buildEnvelope(clickTrack(120, 2), "abc-123");
    expect(env.fingerprint).toBe("abc-123");
    expect(env.sampleRate).toBe(RATE);
    expect(env.frames).toBe(RATE * 2);
    expect(env.seconds).toBeCloseTo(2, 6);
  });
});

describe("detectBpm", () => {
  // Too short to correlate: the guard is what stops a two-bucket file inventing a tempo.
  it("refuses a signal with fewer than 16 hops", () => {
    expect(detectBpm(new Float32Array(8).fill(1), 187.5)).toBe(0);
  });

  it("refuses a rate of zero rather than dividing by it", () => {
    expect(detectBpm(new Float32Array(64).fill(1), 0)).toBe(0);
  });
});
