import { describe, expect, it } from "vitest";
import { beatGrid, type RegionWaveform } from "./waveform";

// beatGrid reads only the arrangement fields; the sample buffers stay empty.
function region(over: Partial<RegionWaveform>): RegionWaveform {
  return {
    peak: [],
    rms: [],
    sampleRate: 48000,
    seconds: 0,
    startBeat: 0,
    clipBeats: 4,
    barBeats: 4,
    tempo: 120,
    warpMarks: [],
    transients: [],
    ...over,
  };
}

describe("beatGrid", () => {
  it("emits a line on every whole beat, timed from the region start by tempo", () => {
    // 4 beats at 120bpm → a beat every 0.5s, inclusive of both ends (0..4).
    // `+ 0` normalizes a harmless signed -0 (Math.ceil(-1e-9)) to 0.
    const lines = beatGrid(region({ startBeat: 0, clipBeats: 4 }));
    expect(lines.map((l) => l.t + 0)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it("flags + labels bar boundaries (1-indexed), leaving plain beats unlabeled", () => {
    const lines = beatGrid(region({ startBeat: 0, clipBeats: 4, barBeats: 4 }));
    expect(lines.map((l) => l.bar)).toEqual([true, false, false, false, true]);
    expect(lines.map((l) => l.label)).toEqual([
      "1",
      undefined,
      undefined,
      undefined,
      "2",
    ]);
  });

  it("aligns bars to the arrangement when the clip starts mid-bar", () => {
    // startBeat 2 spans arrangement beats 2..6; the only bar boundary is beat 4
    // (bar 2). `t` is still measured from the region start, so the first line is 0.
    const lines = beatGrid(region({ startBeat: 2, clipBeats: 4, barBeats: 4 }));
    expect(lines.map((l) => l.t + 0)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(lines.map((l) => l.bar)).toEqual([false, false, true, false, false]);
    expect(lines.find((l) => l.bar)?.label).toBe("2");
  });
});
