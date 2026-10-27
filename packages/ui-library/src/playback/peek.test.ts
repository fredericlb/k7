import { describe, expect, it } from "vitest";
import { bubbleShift, KEY_STEP, PAGE_STEP, stepKey, timeAtX } from "./peek";

describe("timeAtX", () => {
  it("maps a pixel to its second", () => {
    expect(timeAtX(50, 200, 120)).toBe(30);
  });
  it("clamps outside the strip", () => {
    expect(timeAtX(-10, 200, 120)).toBe(0);
    expect(timeAtX(500, 200, 120)).toBe(120);
  });
  it("reads 0 with no width or no duration", () => {
    expect(timeAtX(50, 0, 120)).toBe(0);
    expect(timeAtX(50, 200, 0)).toBe(0);
  });
});

describe("stepKey", () => {
  it("steps by the small and the page step", () => {
    expect(stepKey("ArrowRight", 10, 100)).toBe(10 + KEY_STEP);
    expect(stepKey("ArrowLeft", 10, 100)).toBe(10 - KEY_STEP);
    expect(stepKey("PageUp", 10, 100)).toBe(10 + PAGE_STEP);
  });
  it("stays inside the song", () => {
    expect(stepKey("ArrowLeft", 2, 100)).toBe(0);
    expect(stepKey("PageUp", 90, 100)).toBe(100);
  });
  it("goes to either end", () => {
    expect(stepKey("Home", 40, 100)).toBe(0);
    expect(stepKey("End", 40, 100)).toBe(100);
  });
  it("ignores other keys, and every key before a duration", () => {
    expect(stepKey("a", 40, 100)).toBeNull();
    expect(stepKey("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("bubbleShift", () => {
  it("follows the fraction, clamped", () => {
    expect(bubbleShift(0, 100)).toBe(0);
    expect(bubbleShift(50, 100)).toBe(0.5);
    expect(bubbleShift(200, 100)).toBe(1);
    expect(bubbleShift(5, 0)).toBe(0.5);
  });
});
