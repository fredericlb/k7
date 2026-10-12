// The swipe guard's decision: a sideways wheel is left to whatever can still scroll that way, and cancelled otherwise.

import { describe, expect, it } from "vitest";
import { type ScrollBox, scrollsSideways } from "./noSwipeBack";

const box = (over: Partial<ScrollBox>): ScrollBox => ({
  scrollLeft: 0,
  scrollWidth: 100,
  clientWidth: 100,
  overflowX: "visible",
  parent: null,
  ...over,
});

describe("scrollsSideways", () => {
  it("lets a box with room left that way take the wheel", () => {
    const strip = box({ overflowX: "auto", scrollWidth: 300, scrollLeft: 50 });
    expect(scrollsSideways(strip, -10)).toBe(true);
    expect(scrollsSideways(strip, 10)).toBe(true);
  });

  it("finds that box above the element under the pointer", () => {
    const strip = box({ overflowX: "scroll", scrollWidth: 300 });
    expect(scrollsSideways(box({ parent: strip }), 10)).toBe(true);
  });

  it("refuses at a box's end, the swipe that macOS would turn into Back", () => {
    const strip = box({ overflowX: "auto", scrollWidth: 300, scrollLeft: 0 });
    expect(scrollsSideways(strip, -10)).toBe(false);
    const end = box({ overflowX: "auto", scrollWidth: 300, scrollLeft: 199.5 });
    expect(scrollsSideways(end, 10)).toBe(false);
  });

  it("refuses where nothing scrolls sideways at all", () => {
    expect(
      scrollsSideways(
        box({ parent: box({ overflowX: "hidden", scrollWidth: 500 }) }),
        -10,
      ),
    ).toBe(false);
    expect(scrollsSideways(null, -10)).toBe(false);
  });
});
