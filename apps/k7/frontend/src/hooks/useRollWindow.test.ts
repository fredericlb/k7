// useRollWindow.test.ts — the piano roll's culling window and its hover store.

import { describe, expect, it } from "vitest";
import { createRollHoverStore } from "./useRollHover";
import { rollWindow } from "./useRollWindow";

describe("rollWindow", () => {
  const geo = { origin: 0, ppb: 10, rowH: 5 };
  it("covers the viewport with a viewport of margin on each side", () => {
    const w = rollWindow({ left: 0, top: 0, w: 400, h: 200 }, geo);
    expect(w).toEqual({ b0: -40, b1: 100, r0: -40, r1: 100 });
  });
  it("does not move until the scroll crosses half a viewport", () => {
    const a = rollWindow({ left: 10, top: 10, w: 400, h: 200 }, geo);
    const b = rollWindow({ left: 199, top: 99, w: 400, h: 200 }, geo);
    const c = rollWindow({ left: 200, top: 100, w: 400, h: 200 }, geo);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });
  it("always holds what is on screen", () => {
    for (const left of [0, 137, 512, 1999]) {
      const w = rollWindow({ left, top: 0, w: 400, h: 200 }, geo);
      expect(w?.b0).toBeLessThanOrEqual(left / 10);
      expect(w?.b1).toBeGreaterThanOrEqual((left + 400) / 10);
    }
  });
  it("is null before the scroller is measured", () => {
    expect(rollWindow({ left: 0, top: 0, w: 0, h: 0 }, geo)).toBeNull();
  });
});

describe("createRollHoverStore", () => {
  it("notifies only when the cell changes", () => {
    const s = createRollHoverStore();
    let calls = 0;
    s.subscribe(() => calls++);
    s.set({ row: 1, col: 2 });
    s.set({ row: 1, col: 2 });
    s.set({ row: 1, col: 3 });
    s.set(null);
    s.set(null);
    expect(calls).toBe(3);
    expect(s.get()).toBeNull();
  });
});
