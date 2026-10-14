import type { ClipDoc, ProjectDoc } from "@studio/engine-protocol/project";
import { describe, expect, it } from "vitest";
import {
  beatGrid,
  detectTransients,
  type FileEnvelope,
  type RegionWaveform,
  regionWaveform,
  warpStretch,
} from "./waveform";

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
    toDisplay: (s) => s, // identity: nothing here is windowed or warped
    // …and the same identity as the three numbers the wire carries: no trim, no stretch.
    sourceMap: { inPoint: 0, stretch: 1, zeroBeat: 0 },
    ...over,
  };
}

describe("beatGrid", () => {
  it("emits a line on every whole beat, timed from the region start by tempo", () => {
    // 4 beats at 120bpm → a beat every 0.5s, both ends included; `+ 0` normalizes a signed -0.
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
    // startBeat 2 spans beats 2..6, so bar 2 is the only boundary and `t` still starts at 0.
    const lines = beatGrid(region({ startBeat: 2, clipBeats: 4, barBeats: 4 }));
    expect(lines.map((l) => l.t + 0)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(lines.map((l) => l.bar)).toEqual([false, false, true, false, false]);
    expect(lines.find((l) => l.bar)?.label).toBe("2");
  });
});

// THE CROSS-LANGUAGE CONTRACT, holding the C++ port to the same answer — docs/waveform.md.
describe("detectTransients", () => {
  // Four clean attacks, each a jump then a decay, on a flat-ish floor.
  const burst = (n: number): number[] =>
    Array.from({ length: n }, (_, i) => (i % 10 === 0 ? 1 : 0.9 ** (i % 10)));

  it("reports the bucket AFTER the jump — the onset, not the last quiet one", () => {
    // A single step at index 5: diffs[4] is the jump, so the onset is bucket 5.
    const peak = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    expect(detectTransients(peak)).toEqual([5]);
  });

  it("finds one onset per attack, not several per attack", () => {
    // MIN_GAP = 3 buckets: without it a rise spread over two buckets counts twice.
    expect(detectTransients(burst(40))).toEqual([10, 20, 30]);
  });

  it("takes fewer onsets as the threshold rises, and more as it falls", () => {
    const peak = [0, 0.05, 0, 1, 0.2, 0, 0.4, 0, 0, 1, 0];
    const loose = detectTransients(peak, 0.5).length;
    const tight = detectTransients(peak, 4).length;
    expect(loose).toBeGreaterThanOrEqual(tight);
    expect(tight).toBe(0); // nothing clears mean + 4σ on this shape
  });

  it("answers nothing for an envelope too short to have a derivative", () => {
    expect(detectTransients([])).toEqual([]);
    expect(detectTransients([1, 0])).toEqual([]);
  });

  it("answers nothing for silence, rather than every bucket", () => {
    // stddev is 0, so the threshold is the mean: a flat line must clear nothing.
    expect(detectTransients(new Array(50).fill(0))).toEqual([]);
  });
});

describe("regionWaveform maps the FILE's transients onto the region", () => {
  const env = (over: Partial<FileEnvelope> = {}): FileEnvelope => ({
    fingerprint: "x",
    sampleRate: 48000,
    channels: 1,
    frames: 48000 * 4, // 4 seconds
    seconds: 4,
    peak: new Array(100).fill(0.5),
    rms: new Array(100).fill(0.25),
    transients: [0.5, 1.5, 2.5, 3.5],
    sensitivity: 2,
    bpm: 120,
    ...over,
  });
  const project = { tempo: 120 } as ProjectDoc;
  const clip = (over: Partial<ClipDoc> = {}): ClipDoc =>
    ({ id: "c", type: "audio", source: "a.wav", start: 0, ...over }) as ClipDoc;

  it("passes them through untouched for a clip that starts at the file's head", () => {
    // 4 beats at 120bpm = 2s of display, so only the first two onsets fall inside.
    const w = regionWaveform(env(), clip({ length: 4 }), project, 100);
    expect(w.transients).toEqual([0.5, 1.5]);
  });

  it("shifts them by the in-point, so they follow the audio that is shown", () => {
    // Trimming 1s off the head puts the 1.5s onset at 0.5s on screen.
    const w = regionWaveform(
      env(),
      clip({ length: 4, offset: 1 }),
      project,
      100,
    );
    expect(w.transients).toEqual([0.5, 1.5]);
  });

  it("drops the ones outside the shown span rather than drawing them off-screen", () => {
    const w = regionWaveform(env(), clip({ length: 1 }), project, 100);
    expect(w.transients).toEqual([0.5]); // 0.5s of display at 120bpm
  });

  it("follows the clip file's OWN window, which is where the engine starts playing", () => {
    // What this pins: a drawing reading only `offset` starts every trimmed clip at the head.
    const w = regionWaveform(
      env(),
      clip({ length: 4, sourceFrom: 1 }),
      project,
      100,
    );
    // 1s trimmed off the head: the 1.5s onset is now half a second into the region.
    expect(w.transients).toEqual([0.5, 1.5]);
  });

  it("adds the placement's own offset to that window, as the engine does", () => {
    const w = regionWaveform(
      env(),
      clip({ length: 4, sourceFrom: 1, offset: 1 }),
      project,
      100,
    );
    expect(w.transients).toEqual([0.5, 1.5]);
  });

  it("detects nothing of its own — an envelope with no onsets yields none", () => {
    // Detection belongs to the engine: these peaks would produce onsets if it ran here.
    const peak = new Array(100).fill(0).map((_, i) => (i % 10 === 0 ? 1 : 0));
    const w = regionWaveform(
      env({ peak, transients: [] }),
      clip({ length: 8 }),
      project,
      100,
    );
    expect(w.transients).toEqual([]);
  });

  // These three pin what the WINDOWLESS `whole` view is avoiding — see docs/waveform.md.
  it("opens the region AT `from`, so the head of the file is not in the picture at all", () => {
    const w = regionWaveform(env(), clip({ sourceFrom: 1 }), project, 100);
    expect(w.seconds).toBe(3); // the file's 4, less the second trimmed off its head
    expect(w.transients).toEqual([0.5, 1.5, 2.5]); // the 0.5s onset is gone with it
  });

  it("blanks what lies past `to` rather than shortening the picture", () => {
    // Two different cuts, and only one of them changes the span — see docs/waveform.md.
    const w = regionWaveform(env(), clip({ sourceTo: 2 }), project, 100);
    expect(w.seconds).toBe(4);
    expect(w.peak.slice(0, 50).every((p) => p > 0)).toBe(true);
    expect(w.peak.slice(50).every((p) => p === 0)).toBe(true);
  });

  it("draws the whole file once that window is taken off, which is what `whole` asks for", () => {
    const w = regionWaveform(env(), clip({}), project, 100);
    expect(w.seconds).toBe(4);
    expect(w.peak.every((p) => p > 0)).toBe(true);
    expect(w.transients).toEqual([0.5, 1.5, 2.5, 3.5]); // every onset, none shifted
  });

  it("hands out the mapping the marks went through, so the window lands on the same axis", () => {
    // A second copy of the mapping elsewhere is how a band comes to sit a pixel off the onsets.
    const w = regionWaveform(
      env(),
      clip({ sourceFrom: 1, length: 4 }),
      project,
      100,
    );
    expect(w.toDisplay(1)).toBe(0);
    expect(w.toDisplay(1.5)).toBe(0.5);
  });
  it("resamples the three bands like the peak, a max per column, so the spectrum look keeps its colour", () => {
    const low = new Array(100).fill(0).map((_, i) => (i === 10 ? 0.9 : 0.1));
    const mid = new Array(100).fill(0.2);
    const high = new Array(100).fill(0.3);
    const w = regionWaveform(env({ low, mid, high }), clip({}), project, 50);
    expect(w.low?.length).toBe(50);
    expect(w.low?.[5]).toBe(0.9); // bucket 10 lands in column 5 and is not averaged away
    expect(w.mid?.every((v) => v === 0.2)).toBe(true);
    expect(w.high?.every((v) => v === 0.3)).toBe(true);
  });

  it("sends no bands at all when the sidecar's do not cover the peak's buckets", () => {
    const w = regionWaveform(
      env({ low: [1], mid: [1], high: [1] }),
      clip({}),
      project,
      50,
    );
    expect(w.low).toBeUndefined();
    expect(regionWaveform(env(), clip({}), project, 50).high).toBeUndefined();
  });
});

describe("a WARPED clip is drawn at the rate it is PLAYED at", () => {
  const project = { tempo: 110 } as ProjectDoc;
  const clip = (over: Partial<ClipDoc> = {}): ClipDoc =>
    ({ id: "c", type: "audio", source: "a.wav", start: 0, ...over }) as ClipDoc;

  it("prices the stretch the way the engine does — beats over source seconds", () => {
    // 01.danse.k7's vocals: cut at 120bpm, played at 110, so 12/11 — docs/waveform.md.
    const warp = {
      algorithm: "elastique",
      markers: [
        [0, 0],
        [336.576, 168.288],
      ] as [number, number][],
    };
    expect(warpStretch(warp, 110)).toBeCloseTo(12 / 11, 6);
    // …and an unwarped clip is 1, so it is drawn at the file's own rate.
    expect(warpStretch(undefined, 110)).toBe(1);
    expect(
      warpStretch(
        {
          algorithm: "x",
          markers: [
            [0, 0],
            [4, 0],
          ],
        },
        110,
      ),
    ).toBe(1);
  });

  it("consumes LESS of the source than an unwarped clip over the same span", () => {
    // A clip stretched 2x covers half as much material in the same number of bars.
    const env: FileEnvelope = {
      fingerprint: "x",
      sampleRate: 48000,
      channels: 1,
      frames: 48000 * 8,
      seconds: 8,
      peak: new Array(80).fill(0.5),
      rms: new Array(80).fill(0.25),
      transients: [1, 2, 3, 4],
      sensitivity: 2,
      bpm: 120,
    };
    const twice = {
      algorithm: "elastique",
      markers: [
        [0, 0],
        [8, 2],
      ] as [number, number][],
    };
    // 8 beats at 110bpm over 2 source seconds = a 2.18x stretch.
    const w = regionWaveform(
      env,
      clip({ length: 4, warp: twice }),
      project,
      100,
    );
    const flat = regionWaveform(env, clip({ length: 4 }), project, 100);
    // Same box on screen…
    expect(w.seconds).toBeCloseTo(flat.seconds, 9);
    // …but the onsets are pushed apart, because less of the file fits in it.
    expect(w.transients[0]).toBeGreaterThan(flat.transients[0]);
  });

  // A point pinned IN THE MIDDLE has to bend the picture, which the overall ratio cannot see.
  const bendEnv: FileEnvelope = {
    fingerprint: "x",
    sampleRate: 48000,
    channels: 1,
    frames: 48000 * 4,
    seconds: 4,
    peak: new Array(400).fill(0.5),
    rms: new Array(400).fill(0.25),
    transients: [1, 2, 3],
    sensitivity: 2,
    bpm: 120,
  };
  const ends: [number, number][] = [
    [0, 0],
    [8, 4],
  ];

  it("moves a transient when an interior point is pinned, and not otherwise", () => {
    const flat = regionWaveform(
      bendEnv,
      clip({ length: 8, warp: { algorithm: "e", markers: ends } }),
      project,
      200,
    );
    // The same two ends, plus "one source second in lands on beat 4" — half the clip, not a quarter.
    const bent = regionWaveform(
      bendEnv,
      clip({
        length: 8,
        warp: { algorithm: "e", markers: [ends[0], [4, 1], ends[1]] },
      }),
      project,
      200,
    );
    expect(warpStretch({ algorithm: "e", markers: ends }, 110)).toBeCloseTo(
      warpStretch({ algorithm: "e", markers: [ends[0], [4, 1], ends[1]] }, 110),
      9,
    );
    // …so anything reading only that ratio draws these two identically.
    expect(bent.transients[0]).toBeGreaterThan(flat.transients[0] + 1e-3);
  });

  it("draws every marker where its beat lands, so a point sits on its own line", () => {
    const bent = regionWaveform(
      bendEnv,
      clip({
        length: 8,
        warp: { algorithm: "e", markers: [ends[0], [4, 1], ends[1]] },
      }),
      project,
      200,
    );
    // `orig` and `target` coincide once the picture is warped — docs/waveform.md.
    for (const m of bent.warpMarks) expect(m.orig).toBeCloseTo(m.target, 6);
    // …and each carries the file second it pins, which is how a surface names one to remove it.
    expect(bent.warpMarks.map((m) => m.src)).toEqual([0, 1, 4]);
  });
});
