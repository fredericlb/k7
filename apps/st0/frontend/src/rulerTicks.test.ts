// The tick list, and the window that keeps it bounded. This is what made the zoom's ceiling
// removable: the ladder floors at a 64th of a beat, so a WHOLE-SONG list saturates at 64 nodes
// per beat — 19 000 for a three-minute song, 192 000 for a long set. Windowed to the pane it is
// about forty, at any zoom, on any length of song. See docs/timeline.md.

import { describe, expect, it } from "vitest";
import { rulerTicks } from "./components/Ruler";

const bars = (
  lo: number,
  hi: number,
  unit: number,
  view?: { lo: number; hi: number },
) => rulerTicks("bars", lo, hi, unit, 4, 2, 1, view);

describe("rulerTicks windowing", () => {
  it("builds the whole range when nobody says what is on screen", () => {
    expect(bars(0, 16, 1)).toHaveLength(17);
  });

  it("builds only the slice asked for", () => {
    const all = bars(0, 64, 1);
    const seen = bars(0, 64, 1, { lo: 10, hi: 20 });
    expect(all).toHaveLength(65);
    expect(seen).toHaveLength(11);
    expect(seen[0].beat).toBe(10);
    expect(seen[seen.length - 1].beat).toBe(20);
  });

  /** The property the whole thing rests on: a windowed tick is the SAME tick, its index computed from the origin rather than the window. */
  it("gives a tick the same identity whether or not the list starts at it", () => {
    const all = bars(0, 64, 1);
    const seen = bars(0, 64, 1, { lo: 10, hi: 20 });
    for (const t of seen) {
      const same = all.find((x) => Math.abs(x.beat - t.beat) < 1e-9);
      expect(same).toBeDefined();
      expect(t.index).toBe(same?.index);
      expect(t.level).toBe(same?.level);
      expect(t.label).toBe(same?.label);
      expect(t.key).toBe(same?.key);
    }
  });

  it("never runs past the range it was given, whatever the window claims", () => {
    const wide = bars(4, 8, 1, { lo: -100, hi: 100 });
    expect(wide[0].beat).toBe(4);
    expect(wide[wide.length - 1].beat).toBe(8);
  });

  it("windows the SECONDS ladder too, and by the same rule", () => {
    const all = rulerTicks("seconds", 0, 120, 1, 4, 2, 1);
    const seen = rulerTicks("seconds", 0, 120, 1, 4, 2, 1, { lo: 20, hi: 30 });
    expect(seen.length).toBeLessThan(all.length);
    for (const t of seen) {
      const same = all.find((x) => x.key === t.key);
      expect(t.index).toBe(same?.index);
      expect(t.label).toBe(same?.label);
    }
  });

  // What the count actually becomes at the deepest zoom, said as a number rather than as a hope.
  it("bounds the count by the PANE, not by the song", () => {
    const songBeats = 3000;
    const unit = 1 / 64; // the ladder's floor — the deepest the grid ever gets
    expect(bars(0, songBeats, unit)).toHaveLength(songBeats * 64 + 1);
    // …and the same zoom, windowed to a pane showing four beats plus its margins.
    expect(bars(0, songBeats, unit, { lo: 100, hi: 104 }).length).toBeLessThan(
      300,
    );
  });
});
