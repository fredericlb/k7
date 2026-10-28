// barTint.test.ts — the strip's fill stays opaque while a command waits: a translucent one let the page
// show through the fields being typed.

import { describe, expect, it } from "vitest";
import { barTint } from "./barTint";

describe("the command bar's strip", () => {
  it("keeps its own opaque fill, idle or waiting", () => {
    for (const pending of [false, true])
      expect(barTint(pending)).toContain("bg-popover");
  });

  it("never carries a translucent fill", () => {
    for (const pending of [false, true])
      expect(barTint(pending)).not.toMatch(/bg-[a-z-]+\/\d/);
  });

  it("marks the wait with the accent's ring, breathing unless motion is reduced", () => {
    expect(barTint(false)).not.toContain("animate-pending");
    expect(barTint(true)).toContain("motion-safe:animate-pending");
    expect(barTint(true)).toContain("motion-reduce:ring-2");
  });
});
