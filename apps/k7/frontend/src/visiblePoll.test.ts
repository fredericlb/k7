// visiblePoll.test.ts — the poll waits for a slow tick to END before it counts the next period.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible } from "./visiblePoll";

describe("pollWhileVisible", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never starts a tick while the last one is still running", async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const stop = pollWhileVisible(() => {
      calls++;
      return new Promise<void>((r) => {
        finish = r;
      });
    }, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    stop();
  });

  it("stops for good", async () => {
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 100);
    await vi.advanceTimersByTimeAsync(250);
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
