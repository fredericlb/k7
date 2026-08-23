// The arithmetic of a separation, with no model in sight. What is pinned here is the property
// that matters and is easy to get silently wrong: overlap-add must RECONSTRUCT — feed the same
// signal through every window and the folded result has to be that signal back, not a version
// with a dip every 7.8 seconds where two windows met.

import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  deinterleave,
  HOP,
  OverlapAdd,
  peakOf,
  SEGMENT,
  STEMS,
  triangle,
  wavPcm24,
  windowStarts,
} from "./separateAudio";

describe("how a file is cut into windows", () => {
  it("gives one window to anything shorter than a window", () => {
    expect(windowStarts(1000)).toEqual([0]);
    expect(windowStarts(SEGMENT)).toEqual([0]);
  });

  it("pulls the last window back to end ON the file's end", () => {
    // Not past it: the tail is covered by real audio rather than fading into padded zeros.
    const len = SEGMENT * 3 + 12345;
    const starts = windowStarts(len);
    expect(starts[starts.length - 1]).toBe(len - SEGMENT);
    expect(starts[starts.length - 1] + SEGMENT).toBe(len);
  });

  it("covers every sample, with no gap between consecutive windows", () => {
    const len = SEGMENT * 4 + 999;
    const starts = windowStarts(len);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]).toBeLessThanOrEqual(starts[i - 1] + SEGMENT);
    expect(starts.some((s, i) => i > 0 && s - starts[i - 1] === HOP)).toBe(
      true,
    );
  });
});

describe("the window shape", () => {
  it("is never zero, so a sample only one window covers is not divided away", () => {
    const w = triangle(101);
    expect(Math.min(...w)).toBeGreaterThan(0);
    expect(w[50]).toBeCloseTo(1, 5);
  });
});

describe("overlap-add", () => {
  it("reconstructs the signal it was fed, seams included", () => {
    // A smooth signal rather than noise: a seam shows as a kink, and every sample has a right answer.
    const len = SEGMENT * 2 + 5000;
    const source = new Float32Array(len);
    for (let i = 0; i < len; i++) source[i] = Math.sin(i / 500);

    const oa = new OverlapAdd(len, 1);
    for (const at of windowStarts(len)) {
      const win = source.slice(at, at + SEGMENT);
      oa.add(at, 0, 0, win);
      oa.countWindow(at);
    }
    const [out] = oa.finish(0);

    let worst = 0;
    for (let i = 0; i < len; i++)
      worst = Math.max(worst, Math.abs(out[i] - source[i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it("keeps each stem's accumulator to itself", () => {
    const oa = new OverlapAdd(SEGMENT, STEMS.length);
    oa.add(0, 2, 0, new Float32Array(SEGMENT).fill(1));
    oa.countWindow(0);
    expect(oa.finish(2)[0][SEGMENT >> 1]).toBeCloseTo(1, 5);
    expect(oa.finish(0)[0][SEGMENT >> 1]).toBe(0);
  });
});

describe("deinterleave", () => {
  it("splits ffmpeg's interleaved frames into one buffer per channel", () => {
    const pcm = Float32Array.from([1, -1, 2, -2, 3, -3]);
    expect(deinterleave(pcm, 2).map((c) => [...c])).toEqual([
      [1, 2, 3],
      [-1, -2, -3],
    ]);
  });
});

describe("the WAV it writes", () => {
  const chans = [
    Float32Array.from([0, 0.5, -0.5]),
    Float32Array.from([1, -1, 0]),
  ];
  /** One 24-bit sample, signed, out of the data chunk. */
  const sampleAt = (b: Buffer, frame: number, channel: number): number => {
    const at = 44 + (frame * CHANNELS + channel) * 3;
    const u = b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
    return u & 0x800000 ? u - 0x1000000 : u;
  };

  it("declares itself 24-bit PCM, stereo, and the right length", () => {
    const b = wavPcm24(chans, 44100);
    expect(b.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(b.subarray(8, 12).toString("ascii")).toBe("WAVE");
    // WAVE_FORMAT_PCM, not the 3 a float file carried — see docs/stemSplit.md.
    expect(b.readUInt16LE(20)).toBe(1);
    expect(b.readUInt16LE(22)).toBe(CHANNELS);
    expect(b.readUInt32LE(24)).toBe(44100);
    expect(b.readUInt32LE(28)).toBe(44100 * 2 * 3); // byte rate
    expect(b.readUInt16LE(32)).toBe(2 * 3); // block align
    expect(b.readUInt16LE(34)).toBe(24);
    expect(b.readUInt32LE(40)).toBe(3 * 2 * 3);
    expect(b.length).toBe(44 + 3 * 2 * 3);
  });

  it("round-trips the samples, interleaved, to within a quantum", () => {
    const b = wavPcm24(chans);
    const back = [0, 1, 2].map((i) => [
      sampleAt(b, i, 0) / 0x7fffff,
      sampleAt(b, i, 1) / 0x7fffff,
    ]);
    expect(back[0][0]).toBeCloseTo(0, 6);
    expect(back[0][1]).toBeCloseTo(1, 6);
    expect(back[1][0]).toBeCloseTo(0.5, 6);
    expect(back[1][1]).toBeCloseTo(-1, 6);
    expect(back[2][0]).toBeCloseTo(-0.5, 6);
    expect(back[2][1]).toBeCloseTo(0, 6);
  });

  it("clamps an overshoot instead of wrapping it", () => {
    // Two's complement wrapping would turn the loudest sample into full scale the OTHER way.
    const b = wavPcm24([Float32Array.from([2, -2])], 44100);
    const at = (i: number) => {
      const o = 44 + i * 3;
      const u = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      return u & 0x800000 ? u - 0x1000000 : u;
    };
    expect(at(0)).toBe(0x7fffff);
    expect(at(1)).toBe(-0x800000);
  });
});

describe("peakOf", () => {
  it("finds the loudest sample across every channel, either sign", () => {
    expect(
      peakOf([Float32Array.from([0.2, -0.9]), Float32Array.from([1.4, 0])]),
    ).toBeCloseTo(1.4, 6);
  });

  it("is zero on silence, so nothing is reported as clamped", () => {
    expect(peakOf([new Float32Array(8), new Float32Array(8)])).toBe(0);
  });
});
