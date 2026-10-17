// The transport's room on the bar: centred while it clears both neighbours, in the row otherwise.

import { describe, expect, it } from "vitest";
import { centredFits } from "./useCentredFits";

describe("centredFits", () => {
  // A 1000 px bar from 0, a 200 px cluster centred: it spans 400..600.
  it("fits when both neighbours end well short of the centre", () => {
    expect(centredFits(0, 1000, 200, 300, 700)).toBe(true);
  });

  it("refuses when the left group reaches into the cluster, gap included", () => {
    expect(centredFits(0, 1000, 200, 390, 700)).toBe(false);
  });

  it("refuses when the actions start under it", () => {
    expect(centredFits(0, 1000, 200, 300, 605)).toBe(false);
  });

  it("measures from the bar's own left, wherever the bar starts", () => {
    expect(centredFits(100, 1000, 200, 400, 800)).toBe(true);
    expect(centredFits(100, 1000, 200, 495, 800)).toBe(false);
  });
});
