import { describe, expect, it } from "vitest";
import { createLcdZoom, LCD_MAX_BACKING, lcdBackingScale } from "./lcdZoom";

describe("lcdBackingScale", () => {
  it("multiplies the density by a magnifying zoom", () => {
    expect(lcdBackingScale(2, 3, 200, 100)).toBe(6);
  });

  it("never drops below the density when zoomed out", () => {
    expect(lcdBackingScale(2, 0.4, 200, 100)).toBe(2);
  });

  it("caps the larger side at the backing limit, but not below the density", () => {
    expect(lcdBackingScale(1, 4, 2048, 100)).toBe(LCD_MAX_BACKING / 2048);
    expect(lcdBackingScale(2, 4, 8192, 100)).toBe(2);
  });
});

describe("createLcdZoom", () => {
  it("tells its subscribers of a change, and only of a change", () => {
    const z = createLcdZoom(1);
    let calls = 0;
    const off = z.subscribe(() => calls++);
    z.set(1);
    z.set(2);
    expect([z.get(), calls]).toEqual([2, 1]);
    off();
    z.set(3);
    expect(calls).toBe(1);
  });
});
