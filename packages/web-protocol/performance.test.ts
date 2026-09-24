// performance.test.ts — the rating's two promises: the reference machine is 1000, and every
// metric only ever pushes the score UP. docs/performance.md is the prose.

import { describe, expect, it } from "vitest";
import {
  type EnginePerformanceMetrics,
  enginePerformance,
  formatPerformance,
  PERFORMANCE_REFERENCE,
  PERFORMANCE_WEIGHTS,
  performanceScore,
} from "./performance.ts";

const ref = PERFORMANCE_REFERENCE;

describe("the performance score", () => {
  it("is 1000 on the reference machine", () => {
    expect(performanceScore(ref)).toBe(1000);
  });

  it("weights sum to one", () => {
    const sum = Object.values(PERFORMANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("rises with every metric", () => {
    for (const key of Object.keys(ref) as Array<
      keyof EnginePerformanceMetrics
    >) {
      const better = { ...ref, [key]: (ref[key] ?? 1) * 2 };
      expect(performanceScore(better), key).toBeGreaterThan(1000);
      const worse = { ...ref, [key]: (ref[key] ?? 1) / 2 };
      expect(performanceScore(worse), key).toBeLessThan(1000);
    }
  });

  it("is an integer", () => {
    expect(
      Number.isInteger(performanceScore({ ...ref, singleThread: 77.7 })),
    ).toBe(true);
  });

  it("leaves an unmeasured disk OUT rather than counting it as zero", () => {
    expect(
      performanceScore({ ...ref, diskWriteMBps: null, fsyncPerSec: null }),
    ).toBe(1000);
  });

  it("formats as the badge reads", () => {
    expect(formatPerformance(enginePerformance(ref))).toBe("P 1000");
  });
});
