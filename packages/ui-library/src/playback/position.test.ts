// The position store: a write notifies its readers, a write that changes nothing notifies nobody.

import { describe, expect, it } from "vitest";
import { PositionStore } from "./position";

describe("PositionStore", () => {
  it("starts at rest and hands out the latest value", () => {
    const s = new PositionStore();
    expect(s.get()).toEqual({ position: 0, duration: 0 });
    s.set({ duration: 200 });
    s.set({ position: 12.5 });
    expect(s.get()).toEqual({ position: 12.5, duration: 200 });
  });

  it("notifies on a change and stays quiet on a repeat", () => {
    const s = new PositionStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set({ position: 1 });
    s.set({ position: 1 });
    s.set({ duration: 0 });
    expect(calls).toBe(1);
    off();
    s.set({ position: 2 });
    expect(calls).toBe(1);
  });

  it("keeps the snapshot's identity between unchanged reads, as useSyncExternalStore requires", () => {
    const s = new PositionStore();
    s.set({ position: 3 });
    const a = s.get();
    s.set({ position: 3 });
    expect(s.get()).toBe(a);
  });
});
