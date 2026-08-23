// The bands an engine's link falls in. They replaced a locality TIER — loopback, LAN,
// elsewhere — which ranked a gigabit LAN below a laptop whose interface sat at 2048 frames.
// What you can and cannot do on an engine is decided by the milliseconds.

import { describe, expect, it } from "vitest";
import {
  audioLatencyMs,
  engineLatency,
  formatLatency,
  qualityOf,
} from "./quality.ts";

describe("the quality bands", () => {
  it("splits at 20 and 50 ms", () => {
    expect(qualityOf(0)).toBe("Q1");
    expect(qualityOf(19.9)).toBe("Q1");
    expect(qualityOf(20)).toBe("Q2"); // the boundary belongs to the SLOWER band
    expect(qualityOf(49.9)).toBe("Q2");
    expect(qualityOf(50)).toBe("Q3");
    expect(qualityOf(1000)).toBe("Q3");
  });
});

describe("what the interface costs", () => {
  it("counts a buffer in and a buffer out", () => {
    // The figure a player feels — one period would describe playback alone; see docs/quality.md.
    expect(audioLatencyMs(256, 48000)).toBeCloseTo(10.667, 2);
    expect(audioLatencyMs(128, 48000)).toBeCloseTo(5.333, 2);
    expect(audioLatencyMs(2048, 44100)).toBeCloseTo(92.88, 1);
  });

  it("reads a device that has not opened as UNMEASURED, not as instant", () => {
    // Zeros mean nothing is open; taking them as 0 ms would credit a silent engine with the best latency.
    expect(audioLatencyMs(0, 48000)).toBe(0);
    expect(audioLatencyMs(256, 0)).toBe(0);
  });
});

describe("a link, end to end", () => {
  it("adds the round trip to the interface, and bands the sum", () => {
    // The case the whole change is for: the old locality tier called this Tier 1.
    const near = engineLatency(2, 256, 48000);
    expect(near.totalMs).toBeCloseTo(12.67, 1);
    expect(near.quality).toBe("Q1");

    const sluggish = engineLatency(2, 2048, 44100);
    expect(sluggish.quality).toBe("Q3");

    // …and the mirror: a tight interface is still only as good as the trip to it.
    const far = engineLatency(40, 128, 48000);
    expect(far.quality).toBe("Q2");
  });

  it("prints the one line every surface shows", () => {
    expect(formatLatency(engineLatency(2, 256, 48000))).toBe("Q1 · 13 ms");
  });
});
