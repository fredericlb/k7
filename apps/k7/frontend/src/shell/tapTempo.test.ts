import { describe, expect, it } from "vitest";
import { TAP_RESET_MS, tapTempo } from "./tapTempo";

const tapAll = (times: number[]) =>
  times.reduce<{ taps: number[]; bpm: number | null }>(
    (r, t) => tapTempo(r.taps, t),
    { taps: [], bpm: null },
  );

describe("tapTempo", () => {
  it("gives no tempo for a single tap", () => {
    expect(tapTempo([], 1000)).toEqual({ taps: [1000], bpm: null });
  });

  it("measures the mean interval in whole bpm", () => {
    expect(tapAll([0, 500, 1000, 1500]).bpm).toBe(120);
    expect(tapAll([0, 600, 1210, 1800]).bpm).toBe(100);
  });

  it("starts a new run after a long pause", () => {
    const r = tapAll([0, 500, 1000, 1000 + TAP_RESET_MS + 1]);
    expect(r.taps).toHaveLength(1);
    expect(r.bpm).toBeNull();
  });

  it("averages only the last eight taps", () => {
    const slow = [0, 1000, 2000];
    const fast = Array.from({ length: 8 }, (_, i) => 2500 + i * 500);
    expect(tapAll([...slow, ...fast]).bpm).toBe(120);
  });
});
