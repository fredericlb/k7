// What a stored shape must be: normalised, coarse enough to keep a metadata store small, and
// harmless on silence. pl8's own decoding is not re-tested here — see apps/pl8's own suite.

import { describe, expect, it, vi } from "vitest";

vi.mock("./mediatek.ts", () => ({ getFileEnvelope: vi.fn() }));

import { getFileEnvelope } from "./mediatek.ts";
import {
  downsample,
  envelopeOf,
  MAX_BUCKETS,
  normalise,
} from "./songEnvelope.ts";

describe("downsample", () => {
  it("groups by RMS-of-RMS, so a loud group still reads loud", () => {
    expect(downsample([0, 0, 2, 2], 2)).toEqual([0, 2]);
  });

  it("measures a partial last group on what it actually holds", () => {
    expect(downsample([1, 1, 1], 2)).toEqual([1, 1]);
  });

  it("is the identity when perBucket is 1", () => {
    expect(downsample([0.1, 0.4, 0.9], 1)).toEqual([0.1, 0.4, 0.9]);
  });
});

describe("normalise", () => {
  it("puts the loudest bucket at 1 and rounds to three decimals", () => {
    expect(normalise([1 / 3, 1])).toEqual([0.333, 1]);
  });

  it("leaves silence at zero rather than dividing by its peak", () => {
    expect(normalise([0, 0])).toEqual([0, 0]);
  });
});

describe("envelopeOf", () => {
  it("shapes pl8's measurement into intervalMs/samples/seconds/onsets", async () => {
    vi.mocked(getFileEnvelope).mockResolvedValue({
      sampleRate: 8000,
      seconds: 2,
      rms: [0, 0, 2, 2],
      transients: [0.5, 1.2],
    });
    const env = await envelopeOf("recordings/songbook/uid.flac");
    // 4 buckets over 2s, no downsampling needed (well under MAX_BUCKETS): 0.5s each.
    expect(env.intervalMs).toBe(500);
    expect(env.samples).toEqual([0, 0, 1, 1]);
    expect(env.seconds).toBe(2);
    expect(env.onsets).toEqual([0.5, 1.2]);
  });

  it("caps the bucket count, so a long song costs no more than a short one", async () => {
    // pl8 reporting far more buckets than MAX_BUCKETS — this must still downsample under it.
    const rms = Array.from({ length: 100_000 }, () => 0.1);
    vi.mocked(getFileEnvelope).mockResolvedValue({
      sampleRate: 8000,
      seconds: 600,
      rms,
      transients: [],
    });
    const env = await envelopeOf("recordings/songbook/uid.flac");
    expect(env.samples.length).toBeLessThanOrEqual(MAX_BUCKETS);
  });
});
