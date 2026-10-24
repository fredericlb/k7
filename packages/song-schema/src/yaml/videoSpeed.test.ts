// A placement's `speed` is refused on its line where it could not play: on an activation, which
// has no source to run, and on a reverse that reaches the source's first frame before it ends.

import { describe, expect, it } from "vitest";
import { PlacementSchema } from "./placementSchema";

const issues = (p: Record<string, unknown>) => {
  const r = PlacementSchema.safeParse(p);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("speed on a placement", () => {
  it("takes any finite speed on a shot, backwards included", () => {
    expect(issues({ ref: "a", start: 0, length: 2, speed: 0.5 })).toEqual([]);
    expect(issues({ ref: "a", start: 0, length: 2, speed: 0 })).toEqual([]);
    expect(
      issues({ ref: "a", start: 0, length: 2, from: 3, speed: -1 }),
    ).toEqual([]);
  });

  it("refuses a reverse that runs out of source, on its length", () => {
    expect(
      issues({ ref: "a", start: 0, length: 4, from: 3, speed: -1 }),
    ).toEqual(["length"]);
  });

  it("refuses a speed on an activation", () => {
    expect(issues({ start: 0, length: 2, speed: 2 })).toEqual(["speed"]);
  });
});
