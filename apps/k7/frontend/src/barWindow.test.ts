import { describe, expect, it } from "vitest";
import { anchorBars, barWindow, frameWindow, zoomBars } from "./barWindow";

// The clip panel shows twelve bars of the interval the clip PLAYS, the rest reached by zooming; at 120 bpm in 4/4 a bar is two seconds.

const WHOLE = { from: 0, to: 60 }; // a 60 s take, no from/to — 30 bars

describe("the window", () => {
  it("shows the bars asked for", () => {
    expect(barWindow(WHOLE, 12, 120, 4)).toEqual({
      shown: 12,
      allBars: 30,
      barSec: 2,
      view: { start: 0, end: 24 },
    });
  });

  it("starts where it is asked to", () => {
    // Twelve bars from bar 10: 20 s in, 24 s wide.
    expect(barWindow(WHOLE, 12, 120, 4, 10).view).toEqual({
      start: 20,
      end: 44,
    });
  });

  it("is caged by the clip's from/to — bars count from `from`, nothing shows past `to`", () => {
    // A clip playing 10 s → 30 s of its take is a 10-bar interval; the first twelve bars of THAT are all of it.
    expect(barWindow({ from: 10, to: 30 }, 12, 120, 4)).toEqual({
      shown: 10,
      allBars: 10,
      barSec: 2,
      view: { start: 10, end: 30 },
    });
    // Three bars from bar 2 of the interval: 14 s → 20 s.
    expect(barWindow({ from: 10, to: 30 }, 3, 120, 4, 2).view).toEqual({
      start: 14,
      end: 20,
    });
  });

  it("keeps the window on the interval, wherever the start is asked", () => {
    // Bar 25 + twelve bars runs past the 30-bar take: the start is pulled back to bar 18…
    expect(barWindow(WHOLE, 12, 120, 4, 25).view).toEqual({
      start: 36,
      end: 60,
    });
    // …and a start before the interval is a start at the interval.
    expect(barWindow(WHOLE, 12, 120, 4, -3).view.start).toBe(0);
    expect(barWindow({ from: 10, to: 30 }, 3, 120, 4, -3).view.start).toBe(10);
  });

  it("shows the whole interval when it is shorter than the window", () => {
    // 6 s is three bars. Asking for twelve must not draw nine bars of empty pane.
    expect(barWindow({ from: 0, to: 6 }, 12, 120, 4)).toEqual({
      shown: 3,
      allBars: 3,
      barSec: 2,
      view: { start: 0, end: 6 },
    });
  });

  it("never ends past the interval, even on a part-bar one", () => {
    // 5 s is two and a half bars, so `allBars` rounds UP to 3 — but the view stops at the audio.
    const w = barWindow({ from: 0, to: 5 }, 12, 120, 4);
    expect(w.allBars).toBe(3);
    expect(w.view.end).toBe(5);
  });

  /** What the panel OPENS on, once the two spans stopped being one: the event framed, with the rest of the file around it to judge by. */
  describe("framing the event", () => {
    it("takes the event's bars plus a bar of context either side", () => {
      // 20 s → 30 s is five bars; framed, seven, starting one bar before it.
      expect(frameWindow(WHOLE, { from: 20, to: 30 }, 2)).toEqual({
        bars: 7,
        start: 9,
      });
    });

    it("lands where it says it does, once barWindow has clamped it", () => {
      const f = frameWindow(WHOLE, { from: 20, to: 30 }, 2);
      expect(barWindow(WHOLE, f.bars, 120, 4, f.start).view).toEqual({
        start: 18,
        end: 32,
      });
    });

    it("asks for a start BEFORE the file when the event opens it — barWindow owns that edge", () => {
      // One clamp, in one place: a second one here would be a second answer to one question.
      expect(frameWindow(WHOLE, { from: 0, to: 4 }, 2).start).toBe(-1);
      expect(barWindow(WHOLE, 4, 120, 4, -1).view.start).toBe(0);
    });

    it("frames an event that is a sliver, rather than asking for no bars at all", () => {
      // 0.3 s of a take is a fraction of a bar; a window of zero bars would draw nothing.
      expect(frameWindow(WHOLE, { from: 10, to: 10.3 }, 2).bars).toBe(3);
    });

    it("does not reach outside the file for an event the file outgrew", () => {
      // A `to` past the audio — a window written before a bounce shortened the render.
      expect(frameWindow(WHOLE, { from: 55, to: 90 }, 2)).toEqual({
        bars: 5,
        start: 26,
      });
    });

    it("survives a tempo that has not arrived, like everything else here", () => {
      expect(frameWindow(WHOLE, { from: 1, to: 2 }, 0)).toEqual({
        bars: 1,
        start: 0,
      });
    });
  });

  it("survives a project whose tempo has not arrived", () => {
    // Both come from the compiled doc, absent for the first frames: a bar of zero seconds makes every take infinitely many bars long.
    expect(() => barWindow(WHOLE, 12, 0, 0)).not.toThrow();
    expect(barWindow(WHOLE, 12, 0, 0).allBars).toBeGreaterThan(0);
  });

  it("always shows at least one bar, even of a take with no length", () => {
    expect(barWindow({ from: 0, to: 0 }, 12, 120, 4)).toMatchObject({
      shown: 1,
      allBars: 1,
    });
  });
});

describe("the wheel", () => {
  it("opens the window out and closes it back in", () => {
    expect(zoomBars(12, 1, 30)).toBeGreaterThan(12);
    expect(zoomBars(12, -1, 30)).toBeLessThan(12);
  });

  it("stops at the whole take, and at one bar", () => {
    expect(zoomBars(28, 1, 30)).toBe(30);
    expect(zoomBars(1, -1, 30)).toBe(1);
  });

  it("can still grow from a single bar", () => {
    // ×1.3 of 1 rounds back to 1, so zooming out would have been stuck without the +1.
    expect(zoomBars(1, 1, 30)).toBeGreaterThan(1);
  });
});

describe("the anchor", () => {
  it("keeps the moment under the cursor where it is", () => {
    // Twelve bars from bar 10, cursor halfway → the anchor is bar 16; zoomed to six bars it must still sit halfway.
    const w = barWindow(WHOLE, 12, 120, 4, 10);
    const start = anchorBars(w.view, 0.5, 6, w.barSec);
    expect(start).toBeCloseTo(13);
    expect(barWindow(WHOLE, 6, 120, 4, start).view).toEqual({
      start: 26,
      end: 38,
    });
  });

  it("counts its start from the interval's `from`, not from the file", () => {
    // Interval 10 s → 30 s, three bars from bar 2, cursor halfway → 17 s must still sit halfway at one bar wide.
    const w = barWindow({ from: 10, to: 30 }, 3, 120, 4, 2);
    const start = anchorBars(w.view, 0.5, 1, w.barSec, 10);
    expect(start).toBeCloseTo(3);
    expect(barWindow({ from: 10, to: 30 }, 1, 120, 4, start).view).toEqual({
      start: 16,
      end: 18,
    });
  });

  it("zooming at the left edge is anchored at the start — the old behaviour, as one point of this one", () => {
    const w = barWindow(WHOLE, 12, 120, 4, 10);
    expect(anchorBars(w.view, 0, 6, w.barSec)).toBeCloseTo(10);
  });

  it("hands back an out-of-range start for the window to clamp", () => {
    // Cursor at the right edge, zooming out: the raw start goes negative and barWindow is what pulls it back.
    const w = barWindow(WHOLE, 6, 120, 4, 0);
    const start = anchorBars(w.view, 1, 30, w.barSec);
    expect(start).toBeLessThan(0);
    expect(barWindow(WHOLE, 30, 120, 4, start).view.start).toBe(0);
  });
});
