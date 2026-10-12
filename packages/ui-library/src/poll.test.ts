import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poll } from "./poll";

// Node has no document: a stub with the two things poll reads.
const doc = Object.assign(new EventTarget(), { hidden: false });

beforeEach(() => {
  vi.useFakeTimers();
  doc.hidden = false;
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setHidden = (h: boolean) => {
  doc.hidden = h;
  doc.dispatchEvent(new Event("visibilitychange"));
};

describe("poll", () => {
  it("never starts a tick while the last one is still waiting on the server", async () => {
    let inFlight = 0;
    let most = 0;
    const end = poll(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((ok) => setTimeout(ok, 5000));
      inFlight--;
    }, 1000);
    await vi.advanceTimersByTimeAsync(20_000);
    end();
    expect(most).toBe(1);
  });

  it("rests while hidden, and ticks at once on coming back", async () => {
    const tick = vi.fn();
    const end = poll(tick, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    end();
  });

  it("keeps ticking hidden when asked to", async () => {
    const tick = vi.fn();
    const end = poll(tick, 1000, { whileHidden: true });
    setHidden(true);
    await vi.advanceTimersByTimeAsync(3500);
    expect(tick).toHaveBeenCalledTimes(4);
    end();
  });

  it("stops for good", async () => {
    const tick = vi.fn();
    const end = poll(tick, 1000);
    await vi.advanceTimersByTimeAsync(0);
    end();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
