import { describe, expect, it } from "vitest";
import { barWindow, zoomBars } from "./barWindow";

// The clip panel shows twelve bars by default: a minute of take drawn across a pane is a solid
// block, and what you came to look at is where the attacks are. The rest is reached by zooming out.
//
// 120 bpm, 4/4 → a bar is two seconds. Every number below reads off that.

describe("the window", () => {
  it("shows the bars asked for", () => {
    // A 60 s take is 30 bars; twelve of them is 24 s.
    expect(barWindow(60, 12, 120, 4)).toEqual({
      shown: 12,
      allBars: 30,
      view: { start: 0, end: 24 },
    });
  });

  it("shows the whole take when it is shorter than the window", () => {
    // 6 s is three bars. Asking for twelve must not draw nine bars of empty pane.
    expect(barWindow(6, 12, 120, 4)).toEqual({
      shown: 3,
      allBars: 3,
      view: { start: 0, end: 6 },
    });
  });

  it("never ends past the file, even on a part-bar take", () => {
    // 5 s is two and a half bars, so `allBars` rounds UP to 3 — but the view stops at the audio.
    const w = barWindow(5, 12, 120, 4);
    expect(w.allBars).toBe(3);
    expect(w.view.end).toBe(5);
  });

  it("survives a project whose tempo has not arrived", () => {
    // Both come from the compiled doc, absent for the first frames after a project opens. A bar of
    // zero seconds would make every take infinitely many bars long.
    expect(() => barWindow(60, 12, 0, 0)).not.toThrow();
    expect(barWindow(60, 12, 0, 0).allBars).toBeGreaterThan(0);
  });

  it("always shows at least one bar, even of a take with no length", () => {
    expect(barWindow(0, 12, 120, 4)).toMatchObject({ shown: 1, allBars: 1 });
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
