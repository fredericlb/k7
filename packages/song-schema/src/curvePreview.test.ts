// A curve's picture, the one the curve editor and the graph's card both draw.

import { describe, expect, it } from "vitest";
import {
  previewBeats,
  previewOf,
  previewParts,
  previewPlayhead,
  previewSpan,
} from "./curveMath";

const lfo = {
  type: "lfo" as const,
  polarity: "unipolar" as const,
  amplitude: 1,
  shape: "saw" as const,
  frequency: 1,
  phase: 0,
};

describe("a curve's picture", () => {
  it("spans a cycle and a quarter of the next for an endless oscillator, the quarter not solid", () => {
    expect(previewSpan(lfo, 4, 4)).toEqual({ beats: 5, solid: 4 });
  });

  it("spans the whole duration when it has one, all of it solid", () => {
    expect(previewSpan({ ...lfo, duration: "2:0" }, 4, 4)).toEqual({
      beats: 8,
      solid: 8,
    });
  });

  it("samples the output across the span, wrapping into the next cycle", () => {
    const pts = previewOf(lfo, 4, 4, 10);
    expect(pts).toHaveLength(11);
    // A saw at one cycle a bar: 0.4 of the span is half a cycle; the last sample is a quarter into the next.
    expect(pts[4].y).toBeCloseTo(0.5);
    expect(pts[10].y).toBeCloseTo(0.25);
  });
});

describe("the picture's two parts", () => {
  it("puts a saw's drop in the solid part however coarse the sampling, the boundary in both", () => {
    const saw = {
      type: "lfo" as const,
      polarity: "unipolar" as const,
      amplitude: 0.8,
      cut: "positive" as const,
      shape: "saw" as const,
      frequency: 0.5,
      phase: 0,
    };
    // 48 samples never land on the boundary at 0.8: the solid part must still end at it, on the wrapped value.
    const { solid, faded } = previewParts(saw, 4, 4, 48);
    const end = solid[solid.length - 1];
    expect(end.x).toBeCloseTo(0.8);
    expect(end.y).toBeCloseTo(0);
    expect(solid[solid.length - 2].y).toBeGreaterThan(0.7);
    expect(faded[0]).toEqual(end);
  });
});

describe("the picture's beats", () => {
  it("draws a line per beat across the span, a bar on every fourth in 4/4, and none for an envelope", () => {
    const lfo = {
      type: "lfo" as const,
      polarity: "unipolar" as const,
      amplitude: 1,
      shape: "sine" as const,
      frequency: 1,
      phase: 0,
    };
    // A cycle and a quarter of a bar-long cycle: five beats, so six lines, the first and the fifth on a bar.
    const lines = previewBeats(lfo, 4, 4);
    expect(lines.map((l) => l.bar)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(lines[5].x).toBeCloseTo(1);
    expect(
      previewBeats(
        {
          type: "adsr",
          polarity: "unipolar",
          amplitude: 1,
          attack: 1,
          decay: 1,
          sustain: 1,
          release: 1,
          level: 1,
        },
        4,
        4,
      ),
    ).toEqual([]);
  });
});

describe("the picture's playhead", () => {
  const saw = {
    type: "lfo" as const,
    polarity: "unipolar" as const,
    amplitude: 1,
    shape: "saw" as const,
    frequency: 1,
    phase: 0,
  };

  it("folds the song into an endless oscillator's one cycle, at the value it plays", () => {
    // Bar 3 and a half: half a cycle in, at x 2/5 of a span of five beats.
    const at = previewPlayhead(saw, 10, 4, 4);
    expect(at?.x).toBeCloseTo(0.4);
    expect(at?.y).toBeCloseTo(0.5);
  });

  it("holds at the end of a finite one, and has none for an envelope", () => {
    expect(previewPlayhead({ ...saw, duration: "1:0" }, 30, 4, 4)?.x).toBe(1);
    expect(
      previewPlayhead(
        {
          type: "adsr",
          polarity: "unipolar",
          amplitude: 1,
          attack: 1,
          decay: 1,
          sustain: 1,
          release: 1,
          level: 1,
        },
        3,
        4,
        4,
      ),
    ).toBeNull();
  });
});
