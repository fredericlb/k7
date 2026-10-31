import { describe, expect, it } from "vitest";
import { GUTTER_MOBILE, GUTTER_MOBILE_MAX, mobileGutter } from "./lanes";

describe("mobileGutter", () => {
  it("keeps its floor on a phone held upright, and before the pane is measured", () => {
    expect(mobileGutter(0)).toBe(GUTTER_MOBILE);
    expect(mobileGutter(330)).toBe(GUTTER_MOBILE);
  });
  it("grows with the pane in between", () => {
    expect(mobileGutter(600)).toBe(132);
  });
  it("stops at its ceiling in landscape and on a tablet", () => {
    expect(mobileGutter(780)).toBe(GUTTER_MOBILE_MAX);
    expect(mobileGutter(2000)).toBe(GUTTER_MOBILE_MAX);
  });
});
