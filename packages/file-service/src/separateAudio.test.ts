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
  SEGMENT,
  STEMS,
  triangle,
  wavFloat32,
  windowStarts,
} from "./separateAudio";

describe("how a file is cut into windows", () => {
  it("gives one window to anything shorter than a window", () => {
    expect(windowStarts(1000)).toEqual([0]);
    expect(windowStarts(SEGMENT)).toEqual([0]);
  });

  it("pulls the last window back to end ON the file's end", () => {
    // Not past it. The tail is then covered by real audio rather than by padding, which is the
    // difference between a clean last second and a fade into zeros.
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
    expect(starts.some((s, i) => i > 0 && s - starts[i - 1] === HOP)).toBe(true);
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
    // The real test. A ramp is used rather than noise because a seam shows as a visible kink,
    // and every sample has a known right answer.
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
  const chans = [Float32Array.from([0, 0.5, -0.5]), Float32Array.from([1, -1, 0])];

  it("declares itself float, stereo, and the right length", () => {
    const b = wavFloat32(chans, 44100);
    expect(b.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(b.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(b.readUInt16LE(20)).toBe(3); // WAVE_FORMAT_IEEE_FLOAT, not 1
    expect(b.readUInt16LE(22)).toBe(CHANNELS);
    expect(b.readUInt32LE(24)).toBe(44100);
    expect(b.readUInt16LE(34)).toBe(32);
    expect(b.readUInt32LE(40)).toBe(3 * 2 * 4);
    expect(b.length).toBe(44 + 3 * 2 * 4);
  });

  it("round-trips the samples, interleaved", () => {
    const b = wavFloat32(chans);
    const back = [0, 1, 2].map((i) => [
      b.readFloatLE(44 + i * 8),
      b.readFloatLE(44 + i * 8 + 4),
    ]);
    expect(back).toEqual([
      [0, 1],
      [0.5, -1],
      [-0.5, 0],
    ]);
  });
});
