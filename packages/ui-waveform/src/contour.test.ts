// Where a level lands on the dB scale — the arithmetic both contours share.
//
// It is tested because of what RMS alone hides: on a grid labelled in dBFS, a clip normalised to
// −1 dBFS has its tallest RMS column around −10 and reads as untouched. Hence the second curve,
// and what makes it worth having is that it is reduced the SAME way — two curves on one axis
// that disagree about how they got there are worse than one. So the reduction is pinned here
// rather than left to the eye.

import { describe, expect, it } from "vitest";
import { contourYs } from "./envelope";

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
    // Halving the amplitude twice moves the same distance twice, which is why −20/−40/−60 can be evenly spaced.
    const a = flat(1)[0];
    const b = flat(0.5)[0];
    const c = flat(0.25)[0];
    expect(b - a).toBeCloseTo(c - b, 4);
  });
});

describe("the two contours a pane draws", () => {
  // The same material described twice, nine dB apart as on an ordinary plucked guitar.
  const rms = [0.02, 0.05, 0.11, 0.09, 0.04, 0.02, 0.01, 0.01];
  const peak = [0.2, 0.891, 0.6, 0.4, 0.2, 0.1, 0.05, 0.03];

  const ys = (s: number[]) => contourYs(s, 100, 16, 0, 0.8, H);

  it("draws the peak ABOVE the rms, column for column", () => {
    const r = ys(rms);
    const p = ys(peak);
    expect(p).toHaveLength(r.length);
    // Lower y is higher on screen, and the gap between two curves that never cross is the crest factor.
    for (let i = 0; i < r.length; i++) expect(p[i]).toBeLessThanOrEqual(r[i]);
  });

  it("separates the two by the crest factor — which is what was invisible", () => {
    // The defect as an assertion: the GAP is pinned rather than the tops, which depend on the smoothing below.
    const topRms = dbAt(Math.min(...ys(rms)));
    const topPeak = dbAt(Math.min(...ys(peak)));
    expect(topPeak - topRms).toBeGreaterThan(10);
    expect(topRms).toBeLessThan(-15);
  });

  it("gives both the same number of columns whatever the bucket count", () => {
    // They are blitted onto one canvas at one width, so a mismatch would draw the picture at two scales.
    for (const width of [4, 37, 200])
      expect(contourYs(peak, 100, width, 0, 0.8, H)).toHaveLength(
        contourYs(rms, 100, width, 0, 0.8, H).length,
      );
  });
});

describe("reducing more buckets than there are columns", () => {
  it("averages rather than picking one, so a wide zoom-out loses no column to chance", () => {
    // Two columns over eight buckets: a column is the MEAN in dB of what it covers, not its maximum.
    const s = [1, 1, 1, 1, 0.125, 0.125, 0.125, 0.125];
    const [loud, quiet] = contourYs(s, 100, 2, 0, 0.8, H);
    expect(dbAt(loud)).toBeGreaterThan(dbAt(quiet));
    expect(dbAt(loud)).toBeLessThan(0); // the boundary bucket pulls it down from full scale
    expect(dbAt(quiet)).toBeLessThan(-12);
  });

  /** Every bucket is averaged with its two neighbours in dB before columns are reduced — see docs/envelopes.md. */
  it("averages each bucket with its neighbours before reducing", () => {
    const lone = [0, 0, 1, 0, 0];
    const held = [0, 1, 1, 1, 0];
    const top = (s: number[]) => Math.min(...contourYs(s, 100, 5, 0, 0.5, H));
    // The same full-scale bucket draws LOWER alone than held, by tens of dB here, since its neighbours are silence.
    expect(top(lone)).toBeGreaterThan(top(held));
    expect(dbAt(top(lone))).toBeLessThan(dbAt(top(held)) - 20);

    // A comparison and not an exact top: a column's span is floating-point seconds, so it may take in a sliver more.
  });
});
