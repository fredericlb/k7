// The recording band's x axis: it fills before it scrolls, and its grid stays a grid.

import { describe, expect, it } from "vitest";
import { beatLines, windowStart } from "./recordingWindow";

describe("windowStart", () => {
  it("keeps the take's own start while it is shorter than the window", () => {
    // Written from the left: a short take that slid as it grew would have nothing to read against.
    expect(windowStart(12, 20, 32)).toBe(12);
  });

  it("scrolls once the take outgrows it, newest frame at the right edge", () => {
    expect(windowStart(12, 60, 32)).toBe(28);
  });

  it("holds the window's width exactly at the changeover", () => {
    expect(windowStart(0, 32, 32)).toBe(0);
    expect(windowStart(0, 32.5, 32)).toBe(0.5);
  });
});

describe("beatLines", () => {
  it("puts a line on every whole beat of the window and marks the downbeats", () => {
    const lines = beatLines(0, 8, 4, 800);
    expect(lines.map((l) => l.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lines.filter((l) => l.bar).map((l) => l.beat)).toEqual([0, 4, 8]);
  });

  it("starts at the first whole beat inside a window that begins mid-beat", () => {
    expect(beatLines(2.3, 4, 4, 800).map((l) => l.beat)).toEqual([3, 4, 5, 6]);
  });

  it("numbers bars from the SONG, not from where the take started", () => {
    // The band scrolls to beat 28 of the song; the downbeat there is still every 4th beat.
    const bars = beatLines(28, 8, 4, 800).filter((l) => l.bar);
    expect(bars.map((l) => l.beat)).toEqual([28, 32, 36]);
  });

  it("drops the beats but keeps the bars once the lines would touch", () => {
    // 400 beats across 800px is a line every 2px — a wash, not a rule.
    const lines = beatLines(0, 400, 4, 800);
    expect(lines.every((l) => l.bar)).toBe(true);
    expect(lines.length).toBe(101);
  });

  it("survives a signature it cannot use", () => {
    expect(() => beatLines(0, 8, 0, 800)).not.toThrow();
    expect(beatLines(0, 4, 0, 800).every((l) => l.bar)).toBe(true);
  });
});
