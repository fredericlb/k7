// busy.test.ts — the quit confirm's wording follows the busiest page, and an idle app asks nothing.

import { describe, expect, it } from "vitest";
import { busyReason } from "./busy.ts";

describe("busyReason", () => {
  it("asks nothing when every page is idle", () => {
    expect(busyReason([])).toBeNull();
  });

  it("puts a recording before a playing transport", () => {
    expect(busyReason(["playing", "recording"])?.message).toMatch(/recording/);
    expect(busyReason(["playing"])?.message).toMatch(/playing/);
  });
});
