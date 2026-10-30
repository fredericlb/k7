// targets.test.ts — what the destination promises: the engine once one answers, and a sound
// from the browser, which needs nothing, while none does.

import { describe, expect, it } from "vitest";
import { effectiveTarget, playbackTargetInfo } from "./targets";

describe("effectiveTarget", () => {
  it("plays on the engine once one answers", () => {
    expect(effectiveTarget(true)).toBe("engine");
  });

  // The whole point: an engine that is off still leaves a sound.
  it("falls back to the browser when no engine answers", () => {
    expect(effectiveTarget(false)).toBe("browser");
  });
});

describe("playbackTargetInfo", () => {
  it("gives each destination its own row and a glyph", () => {
    for (const id of ["browser", "engine"] as const) {
      expect(playbackTargetInfo(id).id).toBe(id);
      expect(playbackTargetInfo(id).icon).toBeTruthy();
    }
  });
});
