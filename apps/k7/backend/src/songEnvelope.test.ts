// What a stored shape must be: normalised, coarse enough to keep a metadata store small, and
// harmless on silence. The decoding itself is ffmpeg's and is not re-tested here.

import { describe, expect, it } from "vitest";
import { bucketsOf, decodeArgs, MAX_BUCKETS } from "./songEnvelope.ts";

describe("bucketsOf", () => {
  it("measures each bucket's RMS and puts the loudest at the top", () => {
    // Two buckets: one at ±0.5, one at ±1 — the second is the peak, so it normalises to 1.
    const samples = new Float32Array([0.5, -0.5, 1, -1]);
    expect(bucketsOf(samples, 2)).toEqual([0.5, 1]);
  });

  it("rounds to three decimals, since a stored shape is read whole by the songbook", () => {
    const samples = new Float32Array([1 / 3, 1 / 3, 1, 1]);
    expect(bucketsOf(samples, 2)).toEqual([0.333, 1]);
  });

  it("measures a partial last bucket on what it actually holds", () => {
    // Three samples, two per bucket: the second bucket is one sample and is not read as half-silent.
    expect(bucketsOf(new Float32Array([1, 1, 1]), 2)).toEqual([1, 1]);
  });

  it("leaves silence at zero rather than dividing by its peak", () => {
    expect(bucketsOf(new Float32Array([0, 0, 0, 0]), 2)).toEqual([0, 0]);
  });
});

describe("decodeArgs", () => {
  it("asks ffmpeg for mono floats, which is all a level curve needs", () => {
    const args = decodeArgs("/songs/take.flac");
    expect(args).toContain("/songs/take.flac");
    expect(args.join(" ")).toContain("-ac 1");
    expect(args.join(" ")).toContain("-f f32le");
  });
});

describe("how coarse a shape is", () => {
  it("caps the bucket count, so a long song costs no more than a short one", () => {
    // 8 kHz × 10 minutes is 4.8 M samples: one bucket per 100 ms would be 6000 of them.
    const perBucket = Math.max(1, Math.ceil(4_800_000 / MAX_BUCKETS));
    expect(Math.ceil(4_800_000 / perBucket)).toBeLessThanOrEqual(MAX_BUCKETS);
  });
});
