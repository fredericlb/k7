// A cue point is a place in the FILE, and that is now all it is: a platter is seeked to a
// fraction of its own record. The conversion onto a timeline this file used to pin went with
// the clip that needed it (docs/platter-plan.md, étape 4).

import { describe, expect, it } from "vitest";
import { CUE_COLOURS } from "./deck";

describe("the cue colours", () => {
  it("has one per button, and no two alike", () => {
    // A hot cue works because a hand finds it without reading, which two identical colours undo.
    expect(CUE_COLOURS).toHaveLength(8);
    expect(new Set(CUE_COLOURS).size).toBe(8);
  });
});
