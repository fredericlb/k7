// probe.test.ts — a phone's portrait clip is a landscape stream with a display rotation; missing it plays the clip sideways.

import { describe, expect, it } from "vitest";
import { rotationOf } from "./probe";

describe("rotationOf", () => {
  it("reads ffprobe's display-matrix side data as a quarter turn", () => {
    expect(rotationOf({ side_data_list: [{ rotation: -90 }] })).toBe(270);
    expect(rotationOf({ side_data_list: [{}, { rotation: 90 }] })).toBe(90);
    expect(rotationOf({ side_data_list: [{ rotation: 180 }] })).toBe(180);
  });

  it("reads an older build's rotate tag", () => {
    expect(rotationOf({ tags: { rotate: "90" } })).toBe(90);
  });

  it("is 0 when the stream says nothing", () => {
    expect(rotationOf({})).toBe(0);
    expect(rotationOf({ tags: {}, side_data_list: [] })).toBe(0);
  });
});
