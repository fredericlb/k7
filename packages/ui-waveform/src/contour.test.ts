// Where a level lands on the dB scale — the arithmetic both contours share.
//
// It is tested because of what it was hiding: the pane drew RMS alone on a grid labelled in
// dBFS, so a clip normalised to −1 dBFS drew its tallest column around −10 and read as
// untouched. The fix is a second curve, and the thing that makes a second curve worth having is
// that it is reduced the SAME way — two curves on one axis that disagreed about how they got
// there would be worse than one. So the reduction is pinned here rather than left to the eye.

import { describe, expect, it } from "vitest";
import { contourYs } from "./Waveform";

const H = 100; // canvas height, so a y reads as "percent from the top"
const MIN_DB = -120;

/** The y a constant level draws at, everywhere across the pane. */
const flat = (amp: number, n = 8, width = 16): number[] =>
  contourYs(new Array(n).fill(amp), 100, width, 0, (n * 100) / 1000, H);

/** …and back to dB, so an expectation can be written in the units the grid is labelled in. */
const dbAt = (y: number): number => MIN_DB * (y / H);

describe("the dB scale", () => {
  it("puts full scale at the very top and silence at the bottom", () => {
    expect(flat(1)[0]).toBeCloseTo(0, 6);
    expect(flat(0)[0]).toBeCloseTo(H, 6);
  });

  it("reads back the level it was given", () => {
    // −6.02 dB is amplitude 0.5, the one everybody can check by hand.
    expect(dbAt(flat(0.5)[0])).toBeCloseTo(-6.02, 1);
    expect(dbAt(flat(0.891250938)[0])).toBeCloseTo(-1, 1); // a normalised file
  });

  it("is linear in dB, not in amplitude", () => {
    // Halving the amplitude twice moves the same distance twice — which is the whole reason the
    // grid can carry −20/−40/−60 as evenly spaced lines.
    const a = flat(1)[0];
    const b = flat(0.5)[0];
    const c = flat(0.25)[0];
    expect(b - a).toBeCloseTo(c - b, 4);
  });
});

describe("the two contours a pane draws", () => {
  // The same material, described twice: what it peaks at, and what it averages. Nine dB apart is
  // an ordinary plucked guitar; the pane used to show only the second.
  const rms = [0.02, 0.05, 0.11, 0.09, 0.04, 0.02, 0.01, 0.01];
  const peak = [0.2, 0.891, 0.6, 0.4, 0.2, 0.1, 0.05, 0.03];

  const ys = (s: number[]) => contourYs(s, 100, 16, 0, 0.8, H);

  it("draws the peak ABOVE the rms, column for column", () => {
    const r = ys(rms);
    const p = ys(peak);
    expect(p).toHaveLength(r.length);
    // Lower y is higher on screen. Never crossing is what makes the picture readable: the solid
    // curve sits INSIDE the faint one, so the gap between them is the crest factor.
    for (let i = 0; i < r.length; i++) expect(p[i]).toBeLessThanOrEqual(r[i]);
  });

  it("separates the two by the crest factor — which is what was invisible", () => {
    // The defect, as an assertion. The exact tops depend on the smoothing below, so what is
    // pinned is the GAP: whatever the pane draws, the peak has to stand well clear of the rms,
    // because that distance is the entire reason a normalised clip looked untouched.
    const topRms = dbAt(Math.min(...ys(rms)));
    const topPeak = dbAt(Math.min(...ys(peak)));
    expect(topPeak - topRms).toBeGreaterThan(10);
    expect(topRms).toBeLessThan(-15);
  });

  it("gives both the same number of columns whatever the bucket count", () => {
    // They are blitted onto one canvas at one width; a mismatch would be a picture drawn twice
    // at two scales.
    for (const width of [4, 37, 200])
      expect(contourYs(peak, 100, width, 0, 0.8, H)).toHaveLength(
        contourYs(rms, 100, width, 0, 0.8, H).length,
      );
  });
});

describe("reducing more buckets than there are columns", () => {
  it("averages rather than picking one, so a wide zoom-out loses no column to chance", () => {
    // Two columns over eight buckets: the loud half draws above the quiet half, and neither
    // draws at its own maximum — a column is the MEAN of what it covers, in dB.
    const s = [1, 1, 1, 1, 0.125, 0.125, 0.125, 0.125];
    const [loud, quiet] = contourYs(s, 100, 2, 0, 0.8, H);
    expect(dbAt(loud)).toBeGreaterThan(dbAt(quiet));
    expect(dbAt(loud)).toBeLessThan(0); // the boundary bucket pulls it down from full scale
    expect(dbAt(quiet)).toBeLessThan(-12);
  });

  /**
   * The pass that surprised the author of this file, so it is written down.
   *
   * Before anything is reduced to columns, every bucket is averaged with its two neighbours in
   * the DB domain — `R = 1` in `contourYs`. It takes the edge off single-sample spikes, and it
   * costs a lone transient real height: about 1 dB on a real envelope of a couple of thousand
   * buckets, several on a short synthetic one where the neighbours are far quieter. Anything
   * asserting an exact top has to account for it.
   */
  it("averages each bucket with its neighbours before reducing", () => {
    const lone = [0, 0, 1, 0, 0];
    const held = [0, 1, 1, 1, 0];
    const top = (s: number[]) => Math.min(...contourYs(s, 100, 5, 0, 0.5, H));
    // The same full-scale bucket draws LOWER when it stands alone than when it is held — by
    // tens of dB here, because its neighbours are silence.
    expect(top(lone)).toBeGreaterThan(top(held));
    expect(dbAt(top(lone))).toBeLessThan(dbAt(top(held)) - 20);
    // Stated as a comparison and not as an exact top on purpose: a column's span is computed in
    // floating-point seconds, so one column may take in a neighbouring bucket that lands a
    // sliver inside it. Noise at any real width, and a trap for an exact expectation.
  });
});
