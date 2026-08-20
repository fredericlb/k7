import type { ClipDoc, ProjectDoc } from "@studio/song/project";
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

// THE CROSS-LANGUAGE CONTRACT. This function no longer runs in production — the engine's
// C++ port in engine/moteur/engine/Waveform.cpp does, while it is already downsampling the
// audio — so these cases are what holds the two implementations to the same answer. A change
// here is a change there, plus a sidecar version bump (see waveformCache.ts).
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
    // The bug this pins. `placementToClip` leaves an audio clip's `offset` at 0 and puts the
    // in-point in `sourceFrom`; a drawing reading only `offset` started every trimmed clip at the
    // file's head, so the picture showed one part of the take and the engine played another.
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
    // The proof that detection moved: the peaks here would produce onsets if this still ran
    // the detector on the resampled region.
    const peak = new Array(100).fill(0).map((_, i) => (i % 10 === 0 ? 1 : 0));
    const w = regionWaveform(
      env({ peak, transients: [] }),
      clip({ length: 8 }),
      project,
      100,
    );
    expect(w.transients).toEqual([]);
  });

  /**
   * The same window that puts the picture in the right place also CROPS it, and there is one view where
   * that is wrong: the `whole` one, which exists to show the file the window is being judged against.
   *
   * `clip trim` writes seconds — numbers — and `mapClip` reads exactly those, so opening a trimmed clip
   * redrew the pane as the trim itself, with nothing left to see what had been cut. A TIMECODE window
   * survived it (`Number("2:1")` is NaN), so one field's two spellings drew two different pictures.
   * WaveformOps draws the whole view WINDOWLESS for that reason; these pin what it is avoiding.
   */
  it("opens the region AT `from`, so the head of the file is not in the picture at all", () => {
    const w = regionWaveform(env(), clip({ sourceFrom: 1 }), project, 100);
    expect(w.seconds).toBe(3); // the file's 4, less the second trimmed off its head
    expect(w.transients).toEqual([0.5, 1.5, 2.5]); // the 0.5s onset is gone with it
  });

  it("blanks what lies past `to` rather than shortening the picture", () => {
    // Two different cuts, and only one of them changes the span — worth stating, because it is why
    // a trimmed clip's pane looked like a different take rather than like a shorter one.
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
    // A second copy of `(sec - inPoint) * stretch` somewhere else is how a band comes to sit a
    // pixel off the onsets beside it — the alignment bug this drawing already paid for once.
    const w = regionWaveform(
      env(),
      clip({ sourceFrom: 1, length: 4 }),
      project,
      100,
    );
    expect(w.toDisplay(1)).toBe(0);
    expect(w.toDisplay(1.5)).toBe(0.5);
  });
});

describe("a WARPED clip is drawn at the rate it is PLAYED at", () => {
  const project = { tempo: 110 } as ProjectDoc;
  const clip = (over: Partial<ClipDoc> = {}): ClipDoc =>
    ({ id: "c", type: "audio", source: "a.wav", start: 0, ...over }) as ClipDoc;

  it("prices the stretch the way the engine does — beats over source seconds", () => {
    // 01.danse.st0's vocals: material cut at 120bpm, played in a 110bpm song. The marker pair is
    // [timeline beat, source second], so the ratio is the beat span at the song tempo over the
    // source span — 12/11, the same number applyClipWarp hands Tracktion.
    const warp = {
      algorithm: "elastique",
      markers: [
        [0, 0],
        [336.576, 168.288],
      ] as [number, number][],
    };
    expect(warpStretch(warp, 110)).toBeCloseTo(12 / 11, 6);
    // …and an unwarped clip is 1, which is what keeps every other clip drawn exactly as before.
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
    // A clip stretched 2x covers half as much material in the same number of bars. Drawing it at
    // the file's own rate is what made the picture drift away from the sound across the clip.
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
});
