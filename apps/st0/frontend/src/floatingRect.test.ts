import { describe, expect, it } from "vitest";
import { clampRect, defaultRect } from "./floatingRect";

const R = { x: 100, y: 100, w: 400, h: 300 };

describe("clampRect", () => {
  it("pulls a window dragged off screen back to where its title bar can be grabbed", () => {
    const r = clampRect({ ...R, x: 5000, y: -200 }, 1280, 800);
    expect(r.x).toBeLessThan(1280);
    expect(r.y).toBe(0);
    expect(clampRect({ ...R, x: -5000 }, 1280, 800).x + R.w).toBeGreaterThan(0);
  });

  it("shrinks a window larger than the screen", () => {
    const r = clampRect({ x: 0, y: 0, w: 3000, h: 2000 }, 1280, 800);
    expect(r.w).toBe(1280);
    expect(r.h).toBe(800);
  });
});

describe("defaultRect", () => {
  it("places the first window fully on screen", () => {
    const r = defaultRect(1280, 800);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1280);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
  });
});
