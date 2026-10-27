// A shader knob dragged: a frame per move, a few file writes, and the value the hand stopped on
// always the last one written — a dropped final write would leave the picture where the drag was.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttledParams } from "./useShaderParam";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("throttledParams", () => {
  it("writes a drag's frames as one write per wait, the last value landing", () => {
    const sent: number[] = [];
    const w = throttledParams((_m, _n, v) => sent.push(v), 100);
    for (let i = 1; i <= 10; i++) {
      w.set("mix", "P4", i / 10);
      vi.advanceTimersByTime(25);
    }
    vi.advanceTimersByTime(100);
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent.at(-1)).toBe(1);
  });

  it("keeps two knobs apart", () => {
    const sent: string[] = [];
    const w = throttledParams((m, n, v) => sent.push(`${m}.${n}=${v}`), 100);
    w.set("mix", "P1", 0.2);
    w.set("mix", "P2", 0.7);
    vi.advanceTimersByTime(100);
    expect(sent.sort()).toEqual(["mix.P1=0.2", "mix.P2=0.7"]);
  });

  it("writes what it holds when flushed, and nothing twice", () => {
    const sent: number[] = [];
    const w = throttledParams((_m, _n, v) => sent.push(v), 100);
    w.set("mix", "P3", 0.5);
    w.flushAll();
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([0.5]);
  });
});
