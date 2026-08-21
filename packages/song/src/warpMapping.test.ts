// Where a moment LANDS, through a real map — the arithmetic the picture and the engine share.
//
// `warpStretch` answers one ratio, first marker to last, which is the right answer to "how long
// is this clip" and the wrong one to "where is this moment": `applyClipWarp` pins every interior
// marker as its own beat point, so the segments stretch independently (EditBuilder.cpp). Drawn
// with the ratio alone, a point pinned in the middle moved the sound and left the picture exactly
// where it was — which is what "the waveform does not reflect the warps" was.

import { describe, expect, it } from "vitest";
import { beatAtSource, sourceAtBeat, type WarpMarker } from "./warpPoints";

/** Four seconds of source over eight beats, but the FIRST half is played at half speed:
 *  one source second covers four beats, the remaining three cover the other four. */
const BENT: WarpMarker[] = [
  [0, 0],
  [4, 1],
  [8, 4],
];
/** The identity `seedWarp` writes: two points, no bend. */
const FLAT: WarpMarker[] = [
  [0, 0],
  [8, 4],
];

describe("beatAtSource", () => {
  it("lands each marker on its own beat, exactly", () => {
    for (const [beat, sec] of BENT)
      expect(beatAtSource(BENT, sec)).toBeCloseTo(beat, 9);
  });

  it("bends BETWEEN the markers, which the one-ratio reading could not", () => {
    // Half a source second into a segment running at 4 beats/s is beat 2. The overall ratio
    // (8 beats over 4 s = 2 beats/s) would have said beat 1 — the error a pinned point makes.
    expect(beatAtSource(BENT, 0.5)).toBeCloseTo(2, 9);
    expect(beatAtSource(BENT, 2.5)).toBeCloseTo(6, 9);
  });

  it("continues at the end segments' rate rather than clamping", () => {
    // A clip is not silent past its last marker, and the engine does not stop there either.
    expect(beatAtSource(BENT, 5)).toBeCloseTo(8 + 4 / 3, 9);
    expect(beatAtSource(BENT, -1)).toBeCloseTo(-4, 9);
  });

  it("is the identity when there is no map to speak of", () => {
    // Fewer than two points states no rate; the caller draws the file at its own.
    expect(beatAtSource([], 3)).toBe(3);
    expect(beatAtSource([[0, 0]], 3)).toBe(3);
  });

  it("agrees with the overall ratio when the map is flat — the old reading, still true", () => {
    for (const s of [0, 1, 2.5, 4])
      expect(beatAtSource(FLAT, s)).toBeCloseTo(s * 2, 9);
  });
});

describe("sourceAtBeat", () => {
  it("is the exact inverse — which is what makes a column able to ask what it shows", () => {
    for (const s of [0, 0.25, 1, 2.5, 3.75, 4])
      expect(sourceAtBeat(BENT, beatAtSource(BENT, s))).toBeCloseTo(s, 9);
  });

  it("inverts outside the map too, at the same end rates", () => {
    for (const s of [-2, 6])
      expect(sourceAtBeat(BENT, beatAtSource(BENT, s))).toBeCloseTo(s, 9);
  });

  it("is monotonic, so the picture never doubles back on itself", () => {
    let last = Number.NEGATIVE_INFINITY;
    for (let b = 0; b <= 8; b += 0.25) {
      const s = sourceAtBeat(BENT, b);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});
